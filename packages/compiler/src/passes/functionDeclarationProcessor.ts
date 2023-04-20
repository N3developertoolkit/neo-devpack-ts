import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as TS from '../TS';

import { Scope, createEmptyScope, createScope } from "../types/CompileTimeObject";
import { convertJumpTargetOps, JumpTargetOperation, Operation, updateLocation } from "../types/Operation";
import { CompileError, E_fromSeparated, ParseError, isVoidLike, makeParseError } from "../utils";
import { ContractMethod, ContractSlot } from "../types/CompileOptions";
import { parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
import { VariableFactory, VariableStatementResult, handleVariableStatement } from "./variableStatementProcessor";
import { makeLocalVariable, makeParameter } from "./parseDeclarations";
import { start } from "repl";

interface LoopContext {
    readonly breakTarget: Operation;
    readonly continueTarget: Operation;
}

interface ParseFunctionContext {
    readonly scope: Scope;
    readonly returnTarget: Operation;
    readonly loopContext: readonly LoopContext[];
    readonly errors: readonly ParseError[];
    readonly locals: readonly ContractSlot[];
    readonly operations: readonly Operation[];
}

interface ParseBodyResult {
    readonly operations: readonly Operation[];
    readonly locals: readonly ContractSlot[];
}

function parseStatement(context: ParseFunctionContext, node: tsm.Statement): E.Either<readonly ParseError[], ParseBodyResult> {
    const $context: ParseFunctionContext = { ...context, errors: ROA.empty }
    const { errors, operations, locals } = reduceStatement($context, node);
    return ROA.isNonEmpty(errors) ? E.left(errors) : E.of({ operations, locals });
}

// function pushLoopContext(context: ParseFunctionContext) {
//     const breakTarget = { kind: 'noop' } as Operation;
//     const continueTarget = { kind: 'noop' } as Operation;
//     const loopContext = ROA.prepend({ breakTarget, continueTarget })(context.loopContext);
//     const state: ParseFunctionContext = { ...context, loopContext };
//     return { state, breakTarget, continueTarget };
// }

// function resetLoopContext(context: ParseFunctionContext, originalContext: ParseFunctionContext) {
//     return { ...context, loopContext: originalContext.loopContext } as ParseFunctionContext;
// }


// const matchParseError =
//     (state: ParseFunctionContext) =>
//         (either: E.Either<ParseError, readonly Operation[]>): [readonly Operation[], ParseFunctionContext] => {
//             return pipe(
//                 either,
//                 E.match(
//                     error => [[], {
//                         ...state,
//                         errors: ROA.append(error)(state.errors)
//                     }],
//                     ops => [ops, state]
//                 )
//             );
//         }

function reduceBlock(context: ParseFunctionContext, node: tsm.Block): ParseFunctionContext {
    const $context = {
        ...context,
        // blocks get a new child scope
        scope: createEmptyScope(context.scope),
        // pass in an empty operations array so we can add open/close braces
        operations: ROA.empty
    };

    // process the block statements
    let { errors, locals, operations } = pipe(
        node.getStatements(),
        ROA.reduce($context, reduceStatement)
    );

    // add open/close brace no-ops if they exist
    const open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
    if (open) { operations = ROA.prepend<Operation>({ kind: 'noop', location: open })(operations); }
    const close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
    if (close) { operations = ROA.append<Operation>({ kind: 'noop', location: close })(operations); }

    // append the block operations to the parent context operations
    operations = ROA.concat(operations)(context.operations);

    return { ...context, errors, locals, operations };
}

function reduceEmptyStatement(context: ParseFunctionContext, node: tsm.EmptyStatement): ParseFunctionContext {
    let { operations } = context;
    operations = ROA.append<Operation>({ kind: 'noop', location: node })(operations);
    return { ...context, operations };
}

function reduceReturnStatement(context: ParseFunctionContext, node: tsm.ReturnStatement): ParseFunctionContext {
    return pipe(
        node.getExpression(),
        O.fromNullable,
        O.map(parseExpression(context.scope)),
        O.match(() => E.of(ROA.empty), identity),
        E.map(ROA.append<Operation>({ kind: 'jump', target: context.returnTarget })),
        E.map(updateLocation(node)),
        E.match(
            error => ({ ...context, errors: ROA.append(error)(context.errors) }),
            ops => ({ ...context, operations: ROA.concat(ops)(context.operations) })
        )
    )
}

function reduceThrowStatement(context: ParseFunctionContext, node: tsm.ThrowStatement): ParseFunctionContext {
    return pipe(
        node.getExpression(),
        parseExpression(context.scope),
        E.map(ROA.append<Operation>({ kind: 'throw' })),
        E.map(updateLocation(node)),
        E.match(
            error => ({ ...context, errors: ROA.append(error)(context.errors) }),
            ops => ({ ...context, operations: ROA.concat(ops)(context.operations) })
        )
    )
}

function reduceExpressionStatement(context: ParseFunctionContext, node: tsm.ExpressionStatement): ParseFunctionContext {
    const expr = node.getExpression();
    return pipe(
        expr,
        parseExpression(context.scope),
        E.map(ops => isVoidLike(expr.getType()) || TS.isAssignmentExpression(expr)
            ? ops
            : ROA.append<Operation>({ kind: 'drop' })(ops)),
        E.map(updateLocation(node)),
        E.match(
            error => ({ ...context, errors: ROA.append(error)(context.errors) }),
            ops => ({ ...context, operations: ROA.concat(ops)(context.operations) })
        )
    )
}

function reduceIfStatement(context: ParseFunctionContext, node: tsm.IfStatement): ParseFunctionContext {
    const expr = node.getExpression();
    const elseTarget = { kind: 'noop' } as Operation;
    return pipe(
        expr,
        parseExpressionAsBoolean(context.scope),
        E.map(ops => {
            const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
            const location = closeParen ? { start: node, end: closeParen } : expr;
            return updateLocation(location)(ops);
        }),
        E.map(ROA.append<Operation>({ kind: "jumpifnot", target: elseTarget })),
        E.mapLeft(ROA.of),
        E.chain(operations => parseStatement({ ...context, operations }, node.getThenStatement())),
        E.chain(({ operations, locals }) => {
            const $else = node.getElseStatement();
            if ($else) {
                const endTarget = { kind: 'noop' } as Operation;
                return pipe(
                    operations,
                    ROA.append<Operation>({ kind: "jump", target: endTarget }),
                    ROA.append(elseTarget),
                    operations => parseStatement({ ...context, operations, locals }, $else),
                    E.map(({ operations, locals }) => ({ operations: ROA.append(endTarget)(operations), locals })),
                )
            } else {
                operations = ROA.append(elseTarget)(operations);
                return E.of({ operations, locals });
            }
        }),
        E.match(
            errors => ({ ...context, errors: ROA.concat(errors)(context.errors) }),
            ({ operations, locals }) => ({ ...context, operations, locals })
        )
    )
}

function reduceVariableStatement(context: ParseFunctionContext, node: tsm.VariableStatement): ParseFunctionContext {
    const factory: VariableFactory = (element, symbol, index) => makeLocalVariable(element, symbol, index + context.locals.length);
    return pipe(
        node,
        handleVariableStatement(context.scope)(factory),
        E.match(
            errors => ({ ...context, errors: ROA.concat(errors)(context.errors) }),
            ([scope, vars, ops]) => {
                const operations = ROA.concat(ops)(context.operations);
                const locals = ROA.concat(vars)(context.locals);
                return { ...context, operations, locals, scope };
            }
        )
    );
}

function reduceBreakStatement(context: ParseFunctionContext, node: tsm.BreakStatement): ParseFunctionContext {
    return pipe(
        context.loopContext,
        ROA.head,
        E.fromOption(() => makeParseError(node)('break statement not within a loop or switch')),
        // TODO: if in try/catch block, use endtry instead of jump
        // from C#: if (_tryStack.TryPeek(out ExceptionHandling? result) && result.BreakTargetCount == 0)
        E.map(ctx => ({ kind: 'jump', location: node, target: ctx.breakTarget } as Operation)),
        E.match(
            error => ({ ...context, errors: ROA.append(error)(context.errors) } as ParseFunctionContext),
            op => ({ ...context, operations: ROA.append(op)(context.operations) } as ParseFunctionContext)
        )
    )
}

function reduceContinueStatement(context: ParseFunctionContext, node: tsm.ContinueStatement): ParseFunctionContext {
    return pipe(
        context.loopContext,
        ROA.head,
        E.fromOption(() => makeParseError(node)('break statement not within a loop or switch')),
        // TODO: if in try/catch block, use endtry instead of jump
        // from C#: if (_tryStack.TryPeek(out ExceptionHandling? result) && result.BreakTargetCount == 0)
        E.map(ctx => ({ kind: 'jump', location: node, target: ctx.continueTarget } as Operation)),
        E.match(
            error => ({ ...context, errors: ROA.append(error)(context.errors) } as ParseFunctionContext),
            op => ({ ...context, operations: ROA.append(op)(context.operations) } as ParseFunctionContext)
        )
    )
}

function reduceDoStatement(context: ParseFunctionContext, node: tsm.DoStatement): ParseFunctionContext {

    const startTarget = { kind: 'noop' } as Operation;
    const breakTarget = { kind: 'noop' } as Operation;
    const continueTarget = { kind: 'noop' } as Operation;
    const loopContext = ROA.prepend({ breakTarget, continueTarget })(context.loopContext);

    return pipe(
        node.getStatement(),
        stmt => parseStatement({ ...context, loopContext }, stmt),
        E.chain(({ operations: stmtOps, locals }) => {
            // bookend the statment operations with the start and continue targets
            stmtOps = pipe(
                stmtOps,
                ROA.prepend(startTarget),
                ROA.append(continueTarget));

            return pipe(
                node.getExpression(),
                parseExpressionAsBoolean(context.scope),
                E.map(updateLocation(node.getExpression())),
                E.map(exprOps => ROA.concat(exprOps)(stmtOps)),
                E.map(ROA.append<Operation>({ kind: 'jumpif', target: startTarget })),
                E.map(ROA.append(breakTarget)),
                E.mapLeft(ROA.of),
                E.map(operations => ({ operations: operations as readonly Operation[], locals }))
            )
        }),
        E.match(
            errors => ({ ...context, errors: ROA.concat(errors)(context.errors) } as ParseFunctionContext),
            ({ operations, locals }) => {
                operations = ROA.concat(operations)(context.operations);
                locals = ROA.concat(locals)(context.locals);
                return ({ ...context, operations, locals } as ParseFunctionContext);
            }
        )

    )
}

function reduceWhileStatement(context: ParseFunctionContext, node: tsm.WhileStatement): ParseFunctionContext {
    const breakTarget = { kind: 'noop' } as Operation;
    const continueTarget = { kind: 'noop' } as Operation;
    const loopContext = ROA.prepend({ breakTarget, continueTarget })(context.loopContext);

    return pipe(
        node.getExpression(),
        parseExpressionAsBoolean(context.scope),
        E.map(updateLocation(node.getExpression())),
        E.map(ROA.prepend(continueTarget)),
        E.map(ROA.append<Operation>({ kind: "jumpifnot", target: breakTarget })),
        E.mapLeft(ROA.of),
        E.chain(exprOps => pipe(
            node.getStatement(),
            stmt => parseStatement({ ...context, loopContext }, stmt),
            E.map(({ operations: stmtOps, locals }) => {
                stmtOps = pipe(
                    stmtOps,
                    ROA.append<Operation>({ kind: 'jump', target: continueTarget }),
                    ROA.append<Operation>(breakTarget)
                );
                const operations = ROA.concat(stmtOps)(exprOps);
                return { operations, locals };
            })
        )),
        E.match(
            errors => ({ ...context, errors: ROA.concat(errors)(context.errors) } as ParseFunctionContext),
            ({ locals, operations }) => {
                operations = ROA.concat(operations)(context.operations);
                locals = ROA.concat(locals)(context.locals);
                return ({ ...context, operations, locals } as ParseFunctionContext);
            }
        )
    )
}

const parseInitializer =
    (scope: Scope, locals: readonly ContractSlot[]) =>
        (node?: tsm.VariableDeclarationList | tsm.Expression): E.Either<readonly ParseError[], VariableStatementResult> => {

            if (node === undefined) { return E.of([scope, [], []]); }

            if (tsm.Node.isVariableDeclarationList(node)) {
                const factory: VariableFactory = (element, symbol, index) => makeLocalVariable(element, symbol, index + locals.length);
                return pipe(
                    node,
                    handleVariableStatement(scope)(factory),
                );
            }

            return pipe(
                node,
                parseExpression(scope),
                E.map(ops => isVoidLike(node.getType()) ? ops : ROA.append<Operation>({ kind: 'drop' })(ops)),
                E.mapLeft(ROA.of),
                E.map(updateLocation(node)),
                E.map(ops => [scope, [], ops] as const)
            )
        }

function reduceForStatement(context: ParseFunctionContext, node: tsm.ForStatement): ParseFunctionContext {

    const startTarget = { kind: 'noop' } as Operation;
    const conditionTarget = { kind: 'noop' } as Operation;
    const breakTarget = { kind: 'noop' } as Operation;
    const continueTarget = { kind: 'noop' } as Operation;
    const loopContext = ROA.prepend({ breakTarget, continueTarget })(context.loopContext);

    return pipe(
        node.getInitializer(),
        parseInitializer(context.scope, context.locals),
        E.chain(([scope, locals, initOps]) => {
            initOps = pipe(
                initOps,
                ROA.append<Operation>({ kind: 'jump', target: conditionTarget }),
                ROA.append(startTarget)
            );

            return pipe(
                parseStatement({ ...context, scope, locals, loopContext }, node.getStatement()),
                E.map(({ operations: stmtOps, locals }) => {
                    let operations = pipe(initOps, ROA.concat(stmtOps), ROA.append(continueTarget));
                    return ({ operations, locals });
                }),
                E.chain(({ operations: stmtOps, locals }) => pipe(
                    node.getIncrementor(),
                    O.fromNullable,
                    O.map(incrementor => pipe(
                        incrementor,
                        parseExpression(scope),
                        E.map(ops => isVoidLike(node.getType()) ? ops : ROA.append<Operation>({ kind: 'drop' })(ops)),
                        E.map(updateLocation(incrementor))
                    )),
                    O.sequence(E.Applicative),
                    E.map(O.match(() => [], identity)),
                    E.mapLeft(ROA.of),
                    E.map(incrOps => ROA.concat(incrOps)(stmtOps)),
                    E.map(ROA.append(conditionTarget)),
                    E.chain(incrOps => pipe(
                        node.getCondition(),
                        O.fromNullable,
                        O.map(condition => pipe(
                            condition,
                            parseExpressionAsBoolean(scope),
                            E.map(updateLocation(condition))
                        )),
                        O.sequence(E.Applicative),
                        E.mapLeft(ROA.of),
                        E.map(O.match(
                            () => [<Operation>{ kind: 'jump', target: startTarget }],
                            ops => ROA.append<Operation>({ kind: 'jumpif', target: startTarget })(ops) as readonly Operation[]
                        )),
                        E.map(ROA.append(breakTarget)),
                        E.map(condOps => ROA.concat(condOps)(incrOps) as readonly Operation[])
                    )),
                    E.map(ops => {
                        const operations = ROA.concat(ops)(stmtOps);
                        return { operations, locals };
                    })
                ))
            )
        }),
        E.match(
            errors => ({ ...context, errors: ROA.concat(errors)(context.errors) } as ParseFunctionContext),
            ({ locals, operations }) => {
                operations = ROA.concat(operations)(context.operations);
                locals = ROA.concat(locals)(context.locals);
                return ({ ...context, operations, locals } as ParseFunctionContext);
            }
        )
    );
}

function reduceForInStatement(context: ParseFunctionContext, node: tsm.ForInStatement): ParseFunctionContext {


    const q = pipe(
        node.getInitializer(),
        parseInitializer(context.scope, context.locals),
    )



    const error = makeParseError(node)('for in statement not implemented');
    return { ...context, errors: ROA.append(error)(context.errors) }
}

function reduceForOfStatement(context: ParseFunctionContext, node: tsm.ForOfStatement): ParseFunctionContext {

    // context = parseInitializer(context, node.getInitializer());

    const error = makeParseError(node)('for of statement not implemented');
    return { ...context, errors: ROA.append(error)(context.errors) }

}

// const parseInitializer = (node: tsm.VariableDeclarationList | tsm.Expression): ParseStatementState =>
//     state => {
//         throw new CompileError('parseForStatement not implemented', node);

//     }

// const parseForStatement =
//     (node: tsm.ForStatement): ParseStatementState =>
//         state => {

//             const initializer = node.getInitializer();
//             const condition = node.getCondition();
//             const incrementor = node.getIncrementor();
//             const statement = node.getStatement();


//             const startTarget = { kind: 'noop' } as Operation;
//             const conditionTarget = { kind: 'noop' } as Operation;
//             let { breakTarget, continueTarget, state: stmtState } = pushLoopContext(state);

//             const q = parseStatement(statement)(stmtState);

//             throw new CompileError('parseForStatement not implemented', node);
//         }

// const parseForOfStatement =
//     (node: tsm.ForOfStatement): ParseStatementState =>
//         state => {
//             const initializer = node.getInitializer();
//             const expression = node.getExpression();
//             const statement = node.getStatement();

//             throw new CompileError('parseForOfStatement not implemented', node);
//         }

// const parseForInStatement =
//     (node: tsm.ForInStatement): ParseStatementState =>
//         state => {
//             const initializer = node.getInitializer();
//             const expression = node.getExpression();
//             const statement = node.getStatement();

//             throw new CompileError('parseForInStatement not implemented', node);
//         }

type StatementReduceDispatchMap = {
    [TKind in tsm.SyntaxKind]?: (context: ParseFunctionContext, node: tsm.KindToNodeMappings[TKind]) => ParseFunctionContext;
};

const dispatchMap: StatementReduceDispatchMap = {
    [tsm.SyntaxKind.Block]: reduceBlock,
    [tsm.SyntaxKind.BreakStatement]: reduceBreakStatement,
    [tsm.SyntaxKind.ContinueStatement]: reduceContinueStatement,
    [tsm.SyntaxKind.DoStatement]: reduceDoStatement,
    [tsm.SyntaxKind.EmptyStatement]: reduceEmptyStatement,
    [tsm.SyntaxKind.ExpressionStatement]: reduceExpressionStatement,
    [tsm.SyntaxKind.ForInStatement]: reduceForInStatement,
    [tsm.SyntaxKind.ForOfStatement]: reduceForOfStatement,
    [tsm.SyntaxKind.ForStatement]: reduceForStatement,
    [tsm.SyntaxKind.IfStatement]: reduceIfStatement,
    [tsm.SyntaxKind.ReturnStatement]: reduceReturnStatement,
    [tsm.SyntaxKind.ThrowStatement]: reduceThrowStatement,
    [tsm.SyntaxKind.VariableStatement]: reduceVariableStatement,
    [tsm.SyntaxKind.WhileStatement]: reduceWhileStatement,
}
function reduceStatement(context: ParseFunctionContext, node: tsm.Statement): ParseFunctionContext {

    return dispatch(dispatchMap);

    function dispatch(dispatchMap: StatementReduceDispatchMap) {
        const dispatchFunction = dispatchMap[node.getKind()];
        if (dispatchFunction) {
            return dispatchFunction(context, node as any);
        } else {
            const error = makeParseError(node)(`reduceStatement ${node.getKindName()} not implemented`);
            return { ...context, errors: ROA.append(error)(context.errors) };
        }
    }
}


// case SyntaxKind.ForInStatement:
// case SyntaxKind.ForOfStatement:
// case SyntaxKind.ForStatement:

// case SyntaxKind.SwitchStatement:
// case SyntaxKind.TryStatement:

// case SyntaxKind.ClassDeclaration:
// case SyntaxKind.DebuggerStatement:
// case SyntaxKind.EnumDeclaration:
// case SyntaxKind.ExportAssignment:
// case SyntaxKind.ExportDeclaration:
// case SyntaxKind.FunctionDeclaration:
// case SyntaxKind.ImportDeclaration:
// case SyntaxKind.ImportEqualsDeclaration:
// case SyntaxKind.InterfaceDeclaration:
// case SyntaxKind.LabeledStatement:
// case SyntaxKind.ModuleBlock:
// case SyntaxKind.ModuleDeclaration:
// case SyntaxKind.NotEmittedStatement:
// case SyntaxKind.TypeAliasDeclaration:
// case SyntaxKind.WithStatement:



export const parseBody =
    (scope: Scope) =>
        (body: tsm.Node): E.Either<readonly ParseError[], ParseBodyResult> => {
            if (tsm.Node.isStatement(body)) {
                const context: ParseFunctionContext = {
                    errors: [],
                    returnTarget: { kind: 'return' },
                    locals: [],
                    operations: [],
                    scope,
                    loopContext: [],
                }
                let { errors, locals, operations, returnTarget } = reduceStatement(context, body);
                if (ROA.isNonEmpty(errors)) {
                    return E.left(errors);
                } else {
                    operations = ROA.append(returnTarget)(operations);
                    return E.of({ operations, locals });
                }
            }
            const error = makeParseError(body)(`parseBody ${body.getKindName()} not implemented`)
            return E.left(ROA.of(error));
        }


const makeContractMethod =
    (node: tsm.FunctionDeclaration) =>
        (result: ParseBodyResult): E.Either<ParseError, ContractMethod> => {
            return pipe(
                result.operations,
                // map all the jump target to jump offset operations
                convertJumpTargetOps,
                E.mapLeft(makeParseError(node)),
                E.bindTo('operations'),
                E.bind('symbol', () => pipe(
                    node,
                    TS.parseSymbol,
                    E.chain(flow(
                        // _initialize is a special function emitted by the compiler
                        // so block any function from having this name
                        E.fromPredicate(
                            sym => sym.getName() !== "_initialize",
                            sym => makeParseError(node)(`invalid contract method name "${sym.getName()}"`)
                        )
                    ))
                )),
                E.map(({ symbol, operations }) => ({
                    name: symbol.getName(),
                    node,
                    symbol,
                    operations,
                    variables: result.locals
                } as ContractMethod))
            );
        }

export const makeFunctionScope =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], Scope> => {

            return pipe(
                node.getParameters(),
                ROA.mapWithIndex((index, node) => pipe(
                    node,
                    TS.parseSymbol,
                    E.map(symbol => makeParameter(node, symbol, index))
                )),
                ROA.separate,
                E_fromSeparated,
                E.chain(defs => {
                    return pipe(
                        defs,
                        createScope(parentScope),
                        E.mapLeft(msg => ROA.of(makeParseError(node)(msg)))
                    );
                })
            );
        }

export const parseFunctionDeclaration =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ParseBodyResult> => {
            return pipe(
                node,
                makeFunctionScope(parentScope),
                E.bindTo('scope'),
                E.bind('body', () => pipe(
                    node.getBody(),
                    E.fromNullable(makeParseError(node)("undefined body")),
                    E.mapLeft(ROA.of)
                )),
                E.chain(({ body, scope }) => parseBody(scope)(body)),
                E.map(result => {
                    const params = node.getParameters().length;
                    const locals = result.locals.length;
                    const operations = (params > 0 || locals > 0)
                        ? ROA.prepend({ kind: 'initslot', locals, params } as Operation)(result.operations)
                        : result.operations;
                    return { ...result, operations } as ParseBodyResult;
                })
            );
        }

export const parseContractMethod =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ContractMethod> => {
            return pipe(
                node,
                parseFunctionDeclaration(parentScope),
                E.chain(flow(makeContractMethod(node), E.mapLeft(ROA.of))),
            );
        }
