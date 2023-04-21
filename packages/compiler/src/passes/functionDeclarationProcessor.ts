import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as TS from '../TS';
import * as MONOID from 'fp-ts/Monoid';

import { CompileTimeObject, Scope, createEmptyScope, createScope, updateScope } from "../types/CompileTimeObject";
import { convertJumpTargetOps, EndTryTargetOperation, JumpTargetOperation, Operation, TryTargetOperation, updateLocation } from "../types/Operation";
import { CompileError, E_fromSeparated, ParseError, isVoidLike, makeParseError, updateContextErrors } from "../utils";
import { ContractMethod, ContractSlot } from "../types/CompileOptions";
import { parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
import { VariableFactory, VariableStatementResult, handleVariableDeclaration, handleVariableStatement } from "./variableStatementProcessor";
import { makeLocalVariable, makeParameter } from "./parseDeclarations";
import { TryOffsetOperation } from "../types/Operation";
import { Identifier } from "ts-morph";

// interface LoopContext {
//     readonly breakTarget: Operation;
//     readonly continueTarget: Operation;
// }

// interface ParseFunctionContext {
//     readonly scope: Scope;
//     readonly returnTarget: Operation;
//     readonly loopContext: readonly LoopContext[];
//     readonly errors: readonly ParseError[];
//     readonly locals: readonly ContractSlot[];
//     readonly operations: readonly Operation[];
// }

// function parseStatement(context: ParseFunctionContext, node: tsm.Statement): E.Either<readonly ParseError[], ParseBodyResult> {
//     const $context: ParseFunctionContext = { ...context, errors: ROA.empty }
//     const { errors, operations, locals } = reduceStatement($context, node);
//     return ROA.isNonEmpty(errors) ? E.left(errors) : E.of({ operations, locals });
// }

// // function pushLoopContext(context: ParseFunctionContext) {
// //     const breakTarget = { kind: 'noop' } as Operation;
// //     const continueTarget = { kind: 'noop' } as Operation;
// //     const loopContext = ROA.prepend({ breakTarget, continueTarget })(context.loopContext);
// //     const state: ParseFunctionContext = { ...context, loopContext };
// //     return { state, breakTarget, continueTarget };
// // }

// // function resetLoopContext(context: ParseFunctionContext, originalContext: ParseFunctionContext) {
// //     return { ...context, loopContext: originalContext.loopContext } as ParseFunctionContext;
// // }


// // const matchParseError =
// //     (state: ParseFunctionContext) =>
// //         (either: E.Either<ParseError, readonly Operation[]>): [readonly Operation[], ParseFunctionContext] => {
// //             return pipe(
// //                 either,
// //                 E.match(
// //                     error => [[], {
// //                         ...state,
// //                         errors: ROA.append(error)(state.errors)
// //                     }],
// //                     ops => [ops, state]
// //                 )
// //             );
// //         }


function adaptBlock(node: tsm.Block): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        let $context = { ...context, scope: createEmptyScope(context.scope) };
        let operations: readonly Operation[] = ROA.empty;

        for (const stmt of node.getStatements()) {
            let ops;
            [ops, $context] = adaptStatement(stmt)($context);
            operations = ROA.concat(operations)(ops);
        }

        const open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
        if (open) {
            operations = ROA.prepend({ kind: 'noop', location: open } as Operation)(operations);
        }
        const close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
        if (close) {
            operations = ROA.append({ kind: 'noop', location: close } as Operation)(operations);
        }

        //  keep the accumulated context except swap back in the original
        //  context scope state on return
        return [operations, { ...$context, scope: context.scope }];
    };
}

function adaptEmptyStatement(node: tsm.EmptyStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => [ROA.of({ kind: 'noop', location: node }), context];
}

function adaptReturnStatement(node: tsm.ReturnStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            node.getExpression(),
            O.fromNullable,
            O.map(parseExpression(context.scope)),
            O.getOrElse(() => E.of<ParseError, readonly Operation[]>(ROA.empty)),
            E.map(ROA.append<Operation>({ kind: 'jump', target: context.returnTarget })),
            E.map(updateLocation(node)),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                ops => [ops, context]
            )
        );
    };
}

function adaptThrowStatement(node: tsm.ThrowStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            node.getExpression(),
            parseExpression(context.scope),
            E.map(ROA.append<Operation>({ kind: 'throw' })),
            E.map(updateLocation(node)),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                ops => [ops, context]
            )
        )
    }
}

function adaptExpressionStatement(node: tsm.ExpressionStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    const expr = node.getExpression();
    return context => {
        return pipe(
            expr,
            parseExpression(context.scope),
            E.map(ops => isVoidLike(node.getType()) || TS.isAssignmentExpression(expr)
                ? ops
                : ROA.append<Operation>({ kind: 'drop' })(ops)),
            E.map(updateLocation(node)),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                ops => [ops, context]
            )
        )
    }
}

function adaptIfStatement(node: tsm.IfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    const expr = node.getExpression();
    const elseTarget = { kind: 'noop' } as Operation;
    return context => {
        return pipe(
            expr,
            parseExpressionAsBoolean(context.scope),
            E.map(ops => {
                const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
                const location = closeParen ? { start: node, end: closeParen } : expr;
                return updateLocation(location)(ops);
            }),
            E.map(ROA.append<Operation>({ kind: "jumpifnot", target: elseTarget })),
            E.map((operations: readonly Operation[]) => {

                let $thenOps: readonly Operation[];
                [$thenOps, context] = adaptStatement(node.getThenStatement())(context);
                operations = ROA.concat($thenOps)(operations);

                const $else = node.getElseStatement();
                if ($else) {
                    const endTarget = { kind: 'noop' } as Operation;
                    let $elseOps: readonly Operation[];
                    [$elseOps, context] = adaptStatement($else)(context);
                    operations = pipe(
                        operations,
                        ROA.append<Operation>({ kind: "jump", target: endTarget }),
                        ROA.append(elseTarget),
                        ROA.concat($elseOps),
                        ROA.append(endTarget)
                    );
                    return [operations, context];
                } else {
                    operations = ROA.append(elseTarget)(operations);
                    return [operations, context];
                }
            }),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)] as [readonly Operation[], AdaptStatementContext],
                result => result as [readonly Operation[], AdaptStatementContext]
            )
        )
    }
}

function adaptVariableStatement(node: tsm.VariableStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const factory: VariableFactory = (element, symbol, index) => makeLocalVariable(element, symbol, index + context.locals.length);
        return pipe(
            node,
            handleVariableStatement(context.scope)(factory),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                ([scope, vars, ops]) => {
                    const locals = ROA.concat(vars)(context.locals);
                    return [ops, { ...context, locals, scope }];
                }
            )
        );
    };
}

function adaptBreakStatement(node: tsm.BreakStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            context.breakTargets,
            ROA.head,
            E.fromOption(() => makeParseError(node)('break statement not within a loop or switch')),
            // NCCS uses endtry instead of jump if in try/catch block.
            E.map(target => ({ kind: 'jump', location: node, target } as Operation)),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                op => [ROA.of(op), context]
            )
        )
    }
}

function adaptContinueStatement(node: tsm.ContinueStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            context.continueTargets,
            ROA.head,
            E.fromOption(() => makeParseError(node)('continue statement not within a loop')),
            // NCCS uses endtry instead of jump if in try/catch block.
            E.map(target => ({ kind: 'jump', location: node, target } as Operation)),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                op => [ROA.of(op), context]
            )
        )
    }
}

function adaptDoStatement(node: tsm.DoStatement): S.State<AdaptStatementContext, readonly Operation[]> {

    return context => {
        const startTarget = { kind: 'noop' } as Operation;
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;

        const breakTargets = ROA.prepend(breakTarget)(context.breakTargets);
        const continueTargets = ROA.prepend(continueTarget)(context.continueTargets);
        let $context: AdaptStatementContext = { ...context, breakTargets, continueTargets };

        let stmtOps: readonly Operation[];
        [stmtOps, $context] = adaptStatement(node.getStatement())($context);

        const expr = node.getExpression();
        return pipe(
            expr,
            parseExpressionAsBoolean($context.scope),
            E.map(exprOps => pipe(
                ROA.of(startTarget),
                ROA.concat(stmtOps),
                ROA.append(continueTarget),
                ROA.concat(updateLocation(expr)(exprOps)),
                ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget }),
                ROA.append(breakTarget)
            )),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                ops => {
                    context = { ...$context, breakTargets: context.breakTargets, continueTargets: context.continueTargets }
                    return [ops, context] as [readonly Operation[], AdaptStatementContext];
                }
            )
        )
    }
}

function adaptWhileStatement(node: tsm.WhileStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;

        const breakTargets = ROA.prepend(breakTarget)(context.breakTargets);
        const continueTargets = ROA.prepend(continueTarget)(context.continueTargets);
        let $context: AdaptStatementContext = { ...context, breakTargets, continueTargets };

        let stmtOps: readonly Operation[];
        [stmtOps, $context] = adaptStatement(node.getStatement())($context);

        const expr = node.getExpression();
        return pipe(
            expr,
            parseExpressionAsBoolean($context.scope),
            E.map(exprOps => pipe(
                ROA.of(continueTarget),
                ROA.concat(updateLocation(expr)(exprOps)),
                ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget }),
                ROA.concat(stmtOps),
                ROA.append<Operation>({ kind: 'jump', target: continueTarget }),
                ROA.append(breakTarget)
            )),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                ops => {
                    context = { ...$context, breakTargets: context.breakTargets, continueTargets: context.continueTargets }
                    return [ops as readonly Operation[], context];
                }
            )
        )
    }
}

function adaptCatchVariableDeclaration(node: tsm.CatchClause) {
    return (context: AdaptStatementContext): AdaptStatementContext => {
        const decl = node.getVariableDeclaration();
        if (decl) {
            // if there's a variable declaration, update the context scope
            // to include the new variable and update the context locals
            return pipe(
                decl.getInitializer(),
                E.fromPredicate(
                    i => i === undefined,
                    () => makeParseError(node)('catch variable must not have an initializer')
                ),
                E.chain(() => pipe(
                    decl.getNameNode(),
                    E.fromPredicate(
                        tsm.Node.isIdentifier,
                        () => makeParseError(decl)('catch variable must be a simple identifier')
                    )
                )),
                E.bindTo('name'),
                E.bind('symbol', ({ name }) => TS.parseSymbol(name)),
                E.bind('localvar', ({ name, symbol }) => E.of(makeLocalVariable(name, symbol, context.locals.length))),
                E.bind('scope', ({ name, localvar }) => pipe(
                    localvar,
                    ROA.of,
                    updateScope(context.scope),
                    E.mapLeft(error => makeParseError(name)(error))
                )),
                E.match(
                    error => updateContextErrors(context)(error),
                    ({ localvar: { symbol, node }, scope }) => {
                        const locals = ROA.append({ name: symbol.getName(), type: node.getType() })(context.locals);
                        return ({ ...context, locals, scope });
                    }
                )
            )
        }

        // if there is no declaration, create an anonymous variable to hold the error
        // it doesn't get added to context scope, but it is added to context locals
        const project = node.getProject();
        const scratchFile = project.getSourceFile("scratch.ts") || project.createSourceFile("scratch.ts");
        const varStmt = scratchFile.addVariableStatement({
            declarations: [{ name: `_this_doesnt_matter_${Date.now()}`, type: "any", }]
        });

        return pipe(
            varStmt.getDeclarations(),
            ROA.lookup(0),
            E.fromOption(() => makeParseError(varStmt)('failed to retrieve scratch variable declaration')),
            E.match(
                error => updateContextErrors(context)(error),
                decl => {
                    const locals = ROA.append({ name: "#error", type: decl.getType() })(context.locals);
                    return ({ ...context, locals });
                }
            )
        )
    }
}

function adaptCatchClause(node: tsm.CatchClause, endTarget: Operation): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        let $context = adaptCatchVariableDeclaration(node)(context);
        let blockOps;
        [blockOps, $context] = adaptBlock(node.getBlock())($context);

        let operations = pipe(
            blockOps,
            ROA.prepend<Operation>({ kind: 'storelocal', index: context.locals.length, location: node.getFirstChildByKind(tsm.SyntaxKind.CatchKeyword) }),
            // ROA.append<Operation>({ kind: 'endtry', target: endTarget })
        )

        return [operations, { ...$context, scope: context.scope }];
    }
}


function adaptTryStatement(node: tsm.TryStatement): S.State<AdaptStatementContext, readonly Operation[]> {

    return context => {
        const catchTarget = { kind: 'noop' } as Operation;
        const finallyTarget = { kind: 'noop' } as Operation;
        const endTarget = { kind: 'noop' } as Operation;

        let [tryOps, $context] = adaptBlock(node.getTryBlock())(context);
        let operations: readonly Operation[] = pipe(
            tryOps,
            ROA.prepend<Operation>({ kind: 'try', catchTarget, finallyTarget }),
            ROA.append<Operation>({ kind: 'endtry', target: endTarget }),
        )

        let catchOps: readonly Operation[] = ROA.empty;
        const $catch = node.getCatchClause();
        if ($catch) {
            [catchOps, $context] = adaptCatchClause($catch, endTarget)($context);
        }

        operations = pipe(
            operations,
            ROA.append(catchTarget),
            ROA.concat(catchOps),
            ROA.append<Operation>({ kind: 'endtry', target: endTarget })
        )

        let finallyOps: readonly Operation[] = ROA.empty;
        const $finally = node.getFinallyBlock();
        if ($finally) {
            [finallyOps, $context] = adaptBlock($finally)($context);
        }

        operations = pipe(
            operations,
            ROA.append(finallyTarget),
            ROA.concat(finallyOps),
            ROA.append<Operation>({ kind: 'endfinally' }),
            ROA.append(endTarget)
        )

        return [operations, $context];
    }
}

// const parseInitializer =
//     (scope: Scope, locals: readonly ContractSlot[]) =>
//         (node?: tsm.VariableDeclarationList | tsm.Expression): E.Either<readonly ParseError[], VariableStatementResult> => {

//             if (node === undefined) { return E.of([scope, [], []]); }

//             if (tsm.Node.isVariableDeclarationList(node)) {
//                 const factory: VariableFactory = (element, symbol, index) => makeLocalVariable(element, symbol, index + locals.length);
//                 return pipe(
//                     node,
//                     handleVariableStatement(scope)(factory),
//                 );
//             }

//             return pipe(
//                 node,
//                 parseExpression(scope),
//                 E.map(ops => isVoidLike(node.getType()) ? ops : ROA.append<Operation>({ kind: 'drop' })(ops)),
//                 E.mapLeft(ROA.of),
//                 E.map(updateLocation(node)),
//                 E.map(ops => [scope, [], ops] as const)
//             )
//         }

// function reduceForStatement(context: ParseFunctionContext, node: tsm.ForStatement): ParseFunctionContext {

//     const startTarget = { kind: 'noop' } as Operation;
//     const conditionTarget = { kind: 'noop' } as Operation;
//     const breakTarget = { kind: 'noop' } as Operation;
//     const continueTarget = { kind: 'noop' } as Operation;
//     const loopContext = ROA.prepend({ breakTarget, continueTarget })(context.loopContext);

//     return pipe(
//         node.getInitializer(),
//         parseInitializer(context.scope, context.locals),
//         E.chain(([scope, locals, initOps]) => {
//             initOps = pipe(
//                 initOps,
//                 ROA.append<Operation>({ kind: 'jump', target: conditionTarget }),
//                 ROA.append(startTarget)
//             );

//             return pipe(
//                 parseStatement({ ...context, scope, locals, loopContext }, node.getStatement()),
//                 E.map(({ operations: stmtOps, locals }) => {
//                     let operations = pipe(initOps, ROA.concat(stmtOps), ROA.append(continueTarget));
//                     return ({ operations, locals });
//                 }),
//                 E.chain(({ operations: stmtOps, locals }) => pipe(
//                     node.getIncrementor(),
//                     O.fromNullable,
//                     O.map(incrementor => pipe(
//                         incrementor,
//                         parseExpression(scope),
//                         E.map(ops => isVoidLike(node.getType()) ? ops : ROA.append<Operation>({ kind: 'drop' })(ops)),
//                         E.map(updateLocation(incrementor))
//                     )),
//                     O.sequence(E.Applicative),
//                     E.map(O.match(() => [], identity)),
//                     E.mapLeft(ROA.of),
//                     E.map(incrOps => ROA.concat(incrOps)(stmtOps)),
//                     E.map(ROA.append(conditionTarget)),
//                     E.chain(incrOps => pipe(
//                         node.getCondition(),
//                         O.fromNullable,
//                         O.map(condition => pipe(
//                             condition,
//                             parseExpressionAsBoolean(scope),
//                             E.map(updateLocation(condition))
//                         )),
//                         O.sequence(E.Applicative),
//                         E.mapLeft(ROA.of),
//                         E.map(O.match(
//                             () => [<Operation>{ kind: 'jump', target: startTarget }],
//                             ops => ROA.append<Operation>({ kind: 'jumpif', target: startTarget })(ops) as readonly Operation[]
//                         )),
//                         E.map(ROA.append(breakTarget)),
//                         E.map(condOps => ROA.concat(condOps)(incrOps) as readonly Operation[])
//                     )),
//                     E.map(ops => {
//                         const operations = ROA.concat(ops)(stmtOps);
//                         return { operations, locals };
//                     })
//                 ))
//             )
//         }),
//         E.match(
//             errors => ({ ...context, errors: ROA.concat(errors)(context.errors) } as ParseFunctionContext),
//             ({ locals, operations }) => {
//                 operations = ROA.concat(operations)(context.operations);
//                 locals = ROA.concat(locals)(context.locals);
//                 return ({ ...context, operations, locals } as ParseFunctionContext);
//             }
//         )
//     );
// }

// function reduceForInStatement(context: ParseFunctionContext, node: tsm.ForInStatement): ParseFunctionContext {


//     const q = pipe(
//         node.getInitializer(),
//         parseInitializer(context.scope, context.locals),
//     )



//     const error = makeParseError(node)('for in statement not implemented');
//     return { ...context, errors: ROA.append(error)(context.errors) }
// }

// function reduceForOfStatement(context: ParseFunctionContext, node: tsm.ForOfStatement): ParseFunctionContext {

//     // context = parseInitializer(context, node.getInitializer());

//     const error = makeParseError(node)('for of statement not implemented');
//     return { ...context, errors: ROA.append(error)(context.errors) }

// }

// // const parseInitializer = (node: tsm.VariableDeclarationList | tsm.Expression): ParseStatementState =>
// //     state => {
// //         throw new CompileError('parseForStatement not implemented', node);

// //     }

// // const parseForStatement =
// //     (node: tsm.ForStatement): ParseStatementState =>
// //         state => {

// //             const initializer = node.getInitializer();
// //             const condition = node.getCondition();
// //             const incrementor = node.getIncrementor();
// //             const statement = node.getStatement();


// //             const startTarget = { kind: 'noop' } as Operation;
// //             const conditionTarget = { kind: 'noop' } as Operation;
// //             let { breakTarget, continueTarget, state: stmtState } = pushLoopContext(state);

// //             const q = parseStatement(statement)(stmtState);

// //             throw new CompileError('parseForStatement not implemented', node);
// //         }

// // const parseForOfStatement =
// //     (node: tsm.ForOfStatement): ParseStatementState =>
// //         state => {
// //             const initializer = node.getInitializer();
// //             const expression = node.getExpression();
// //             const statement = node.getStatement();

// //             throw new CompileError('parseForOfStatement not implemented', node);
// //         }

// // const parseForInStatement =
// //     (node: tsm.ForInStatement): ParseStatementState =>
// //         state => {
// //             const initializer = node.getInitializer();
// //             const expression = node.getExpression();
// //             const statement = node.getStatement();

// //             throw new CompileError('parseForInStatement not implemented', node);
// //         }

// type StatementReduceDispatchMap = {
//     [TKind in tsm.SyntaxKind]?: (context: ParseFunctionContext, node: tsm.KindToNodeMappings[TKind]) => ParseFunctionContext;
// };

// const dispatchMap: StatementReduceDispatchMap = {
//     [tsm.SyntaxKind.Block]: reduceBlock,
//     [tsm.SyntaxKind.BreakStatement]: reduceBreakStatement,
//     [tsm.SyntaxKind.ContinueStatement]: reduceContinueStatement,
//     [tsm.SyntaxKind.DoStatement]: reduceDoStatement,
//     [tsm.SyntaxKind.EmptyStatement]: reduceEmptyStatement,
//     [tsm.SyntaxKind.ExpressionStatement]: reduceExpressionStatement,
//     [tsm.SyntaxKind.ForInStatement]: reduceForInStatement,
//     [tsm.SyntaxKind.ForOfStatement]: reduceForOfStatement,
//     [tsm.SyntaxKind.ForStatement]: reduceForStatement,
//     [tsm.SyntaxKind.IfStatement]: reduceIfStatement,
//     [tsm.SyntaxKind.ReturnStatement]: reduceReturnStatement,
//     [tsm.SyntaxKind.ThrowStatement]: reduceThrowStatement,
//     [tsm.SyntaxKind.VariableStatement]: reduceVariableStatement,
//     [tsm.SyntaxKind.WhileStatement]: reduceWhileStatement,
// }
// function reduceStatement(context: ParseFunctionContext, node: tsm.Statement): ParseFunctionContext {

//     return dispatch(dispatchMap);

//     function dispatch(dispatchMap: StatementReduceDispatchMap) {
//         const dispatchFunction = dispatchMap[node.getKind()];
//         if (dispatchFunction) {
//             return dispatchFunction(context, node as any);
//         } else {
//             const error = makeParseError(node)(`reduceStatement ${node.getKindName()} not implemented`);
//             return { ...context, errors: ROA.append(error)(context.errors) };
//         }
//     }
// }


// // case SyntaxKind.ForInStatement:
// // case SyntaxKind.ForOfStatement:
// // case SyntaxKind.ForStatement:

// // case SyntaxKind.SwitchStatement:
// // case SyntaxKind.TryStatement:

// // case SyntaxKind.ClassDeclaration:
// // case SyntaxKind.DebuggerStatement:
// // case SyntaxKind.EnumDeclaration:
// // case SyntaxKind.ExportAssignment:
// // case SyntaxKind.ExportDeclaration:
// // case SyntaxKind.FunctionDeclaration:
// // case SyntaxKind.ImportDeclaration:
// // case SyntaxKind.ImportEqualsDeclaration:
// // case SyntaxKind.InterfaceDeclaration:
// // case SyntaxKind.LabeledStatement:
// // case SyntaxKind.ModuleBlock:
// // case SyntaxKind.ModuleDeclaration:
// // case SyntaxKind.NotEmittedStatement:
// // case SyntaxKind.TypeAliasDeclaration:
// // case SyntaxKind.WithStatement:


interface AdaptStatementContext {
    readonly errors: readonly ParseError[];
    readonly locals: readonly ContractSlot[];
    readonly scope: Scope;
    readonly returnTarget: Operation;
    readonly breakTargets: readonly Operation[];
    readonly continueTargets: readonly Operation[];
}


interface AdaptDispatchContext {
    readonly errors: readonly ParseError[];
}

export type AdaptDispatchMap<A, T extends AdaptDispatchContext> = {
    [TKind in tsm.SyntaxKind]?: (node: tsm.KindToNodeMappings[TKind]) => S.State<T, A>;
};

const adaptDispatchMap: AdaptDispatchMap<readonly Operation[], AdaptStatementContext> = {
    [tsm.SyntaxKind.Block]: adaptBlock,
    [tsm.SyntaxKind.BreakStatement]: adaptBreakStatement,
    [tsm.SyntaxKind.ContinueStatement]: adaptContinueStatement,
    [tsm.SyntaxKind.DoStatement]: adaptDoStatement,
    [tsm.SyntaxKind.EmptyStatement]: adaptEmptyStatement,
    [tsm.SyntaxKind.ExpressionStatement]: adaptExpressionStatement,
    // [tsm.SyntaxKind.ForInStatement]: adaptForInStatement,
    // [tsm.SyntaxKind.ForOfStatement]: adaptForOfStatement,
    // [tsm.SyntaxKind.ForStatement]: adaptForStatement,
    [tsm.SyntaxKind.IfStatement]: adaptIfStatement,
    [tsm.SyntaxKind.ReturnStatement]: adaptReturnStatement,
    [tsm.SyntaxKind.ThrowStatement]: adaptThrowStatement,
    [tsm.SyntaxKind.TryStatement]: adaptTryStatement,
    [tsm.SyntaxKind.VariableStatement]: adaptVariableStatement,
    [tsm.SyntaxKind.WhileStatement]: adaptWhileStatement,
}

export const dispatchAdapt =
    <A, T extends AdaptDispatchContext>(name: string, dispatchMap: AdaptDispatchMap<A, T>, monoid: MONOID.Monoid<A>) =>
        (node: tsm.Node): S.State<T, A> =>
            (context: T) => {
                const dispatchFunction = dispatchMap[node.getKind()];
                if (dispatchFunction) {
                    return dispatchFunction(node as any)(context);
                } else {
                    const error = makeParseError(node)(`${name} ${node.getKindName()} not implemented`);
                    const errors = ROA.append(error)(context.errors);
                    return [monoid.empty, { ...context, errors }];
                }
            }

const adaptStatement = dispatchAdapt("adaptStatement", adaptDispatchMap, ROA.getMonoid());

interface ParseBodyResult {
    readonly operations: readonly Operation[];
    readonly locals: readonly ContractSlot[];
}

function parseBody({ scope, body }: { scope: Scope, body: tsm.Node }): E.Either<readonly ParseError[], ParseBodyResult> {
    if (tsm.Node.isStatement(body)) {

        const context: AdaptStatementContext = {
            scope,
            errors: [],
            locals: [],
            returnTarget: { kind: 'return' },
            breakTargets: [],
            continueTargets: [],
        };
        let [operations, { errors, locals }] = adaptStatement(body)(context);

        if (ROA.isNonEmpty(errors)) return E.left(errors);
        operations = ROA.append<Operation>(context.returnTarget)(operations);
        return E.of({ operations, locals });
    }

    return pipe(
        `parseBody ${body.getKindName()} not implemented`,
        makeParseError(body),
        ROA.of,
        E.left
    )
}

const adaptFunctionDeclaration = (parentScope: Scope, node: tsm.FunctionDeclaration): S.State<readonly ParseError[], ParseBodyResult> =>
    errors => {
        return pipe(
            E.Do,
            E.bind('scope', () => pipe(
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
            )),
            E.bind('body', () => pipe(
                node.getBody(),
                E.fromNullable(makeParseError(node)("undefined body")),
                E.mapLeft(ROA.of)
            )),
            E.chain(parseBody),
            E.map(({ locals, operations }) => {
                const params = node.getParameters().length;
                if (params > 0 || locals.length > 0) {
                    operations = ROA.prepend<Operation>({ kind: 'initslot', locals: locals.length, params })(operations);
                }
                return { locals, operations };
            }),
            E.match(
                $errors => [{ operations: [], locals: [] }, ROA.concat($errors)(errors)],
                result => [result, errors]
            )
        )
    }

const adaptContractMethod =
    (node: tsm.FunctionDeclaration) =>
        ({ locals, operations }: ParseBodyResult): S.State<readonly ParseError[], O.Option<ContractMethod>> =>
            errors => pipe(
                node,
                TS.parseSymbol,
                E.chain(flow(
                    // _initialize is a special function emitted by the compiler
                    // so block any function from having this name
                    E.fromPredicate(
                        symbol => symbol.getName() !== "_initialize",
                        symbol => makeParseError(node)(`invalid contract method name "${symbol.getName()}"`)
                    )
                )),
                E.map(symbol => ({
                    name: symbol.getName(),
                    node,
                    symbol,
                    operations,
                    variables: locals
                } as ContractMethod)),
                E.match(
                    error => [O.none, ROA.append(error)(errors)],
                    method => [O.some(method), errors]
                )
            )

export const parseContractMethod =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ContractMethod> => {
            return pipe(
                ROA.empty,
                pipe(
                    adaptFunctionDeclaration(parentScope, node),
                    S.chain(adaptContractMethod(node)),
                ),
                ([optMethod, errors]) => pipe(
                    errors,
                    E.fromPredicate(ROA.isEmpty, identity),
                    E.chain(() => pipe(
                        optMethod,
                        E.fromOption(() => makeParseError(node)("undefined method")),
                        E.mapLeft(ROA.of)
                    ))
                )
            )
        }
