import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as TS from '../TS';
import * as MONOID from 'fp-ts/Monoid';

import { Scope, createEmptyScope, createScope, updateScope } from "../types/CompileTimeObject";
import { Operation, getBooleanConvertOps, updateLocation } from "../types/Operation";
import { E_fromSeparated, ParseError, isVoidLike, makeParseError, updateContextErrors } from "../utils";
import { ContractMethod, ContractSlot } from "../types/CompileOptions";
import { parseExpression } from "./expressionProcessor";
import { VariableFactory, handleVariableStatement } from "./variableStatementProcessor";
import { makeLocalVariable, makeParameter } from "./parseDeclarations";

function adaptExpression(node: tsm.Expression, convertOps: readonly Operation[] = []): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            node,
            parseExpression(context.scope),
            E.map(ROA.concat(convertOps)),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)],
                ops => [ops, context]
            )
        )
    }
}

function adaptExpressionAsBoolean(node: tsm.Expression): S.State<AdaptStatementContext, readonly Operation[]> {
    return adaptExpression(node, getBooleanConvertOps(node.getType()));
}

function adaptBlock(node: tsm.Block): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        let $context = { ...context, scope: createEmptyScope(context.scope) };
        let ops: readonly Operation[] = ROA.empty;

        for (const stmt of node.getStatements()) {
            let $ops;
            [$ops, $context] = adaptStatement(stmt)($context);
            ops = ROA.concat($ops)(ops);
        }

        const open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
        if (open) {
            ops = ROA.prepend({ kind: 'noop', location: open } as Operation)(ops);
        }
        const close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
        if (close) {
            ops = ROA.append({ kind: 'noop', location: close } as Operation)(ops);
        }

        //  keep the accumulated context except swap back in the original
        //  context scope state on return
        return [ops, { ...$context, scope: context.scope }];
    };
}

function adaptEmptyStatement(node: tsm.EmptyStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => [ROA.of({ kind: 'noop', location: node }), context];
}

function adaptReturnStatement(node: tsm.ReturnStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        const expr = node.getExpression();
        let [ops, $context] = expr ? adaptExpression(expr)(context) : [ROA.empty, context];

        ops = pipe(
            ops,
            ROA.append<Operation>({ kind: 'jump', target: context.returnTarget }),
            updateLocation(node)
        );

        return [ops, $context];
    };
}

function adaptThrowStatement(node: tsm.ThrowStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        let [ops, $context] = adaptExpression(node.getExpression())(context);
        ops = pipe(
            ops,
            ROA.append<Operation>({ kind: 'throw' }),
            updateLocation(node)
        );
        return [ops, $context];
    }
}

function adaptExpressionStatement(node: tsm.ExpressionStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    const expr = node.getExpression();
    return context => {

        const dropOps: readonly Operation[] = isVoidLike(node.getType()) ? ROA.empty : ROA.of({ kind: 'drop' });
        let [ops, $context] = adaptExpression(expr)(context);
        ops = pipe(ops,
            updateLocation(node),
            ROA.concat(dropOps)
        );
        return [ops, $context];
    }
}

function adaptIfStatement(node: tsm.IfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const elseTarget = { kind: 'noop' } as Operation;

        const expr = node.getExpression();
        let [ops, $context] = adaptExpressionAsBoolean(expr)(context);
        const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
        ops = pipe(
            ops,
            ROA.append<Operation>({ kind: 'jumpifnot', target: elseTarget }),
            updateLocation(closeParen ? { start: node, end: closeParen } : expr)
        )

        let $thenOps: readonly Operation[];
        [$thenOps, $context] = adaptStatement(node.getThenStatement())($context);
        ops = ROA.concat($thenOps)(ops);

        const $else = node.getElseStatement();
        if ($else) {
            const endTarget = { kind: 'noop' } as Operation;
            let $elseOps: readonly Operation[];
            [$elseOps, $context] = adaptStatement($else)($context);
            ops = pipe(
                ops,
                ROA.append<Operation>({ kind: 'jump', target: endTarget }),
                ROA.append(elseTarget),
                ROA.concat($elseOps),
                ROA.append(endTarget)
            );
        } else {
            ops = ROA.append(elseTarget)(ops);
        }
        return [ops, $context];
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
            // NCCS uses endtry instead of jump if in try/catch block.
            O.map(target => ({ kind: 'jump', location: node, target } as Operation)),
            O.match(
                () => {
                    const error = makeParseError(node)('break statement not within a loop or switch');
                    return [ROA.empty, updateContextErrors(context)(error)];
                },
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
            // NCCS uses endtry instead of jump if in try/catch block.
            O.map(target => ({ kind: 'jump', location: node, target } as Operation)),
            O.match(
                () => {
                    const error = makeParseError(node)('break statement not within a loop or switch');
                    return [ROA.empty, updateContextErrors(context)(error)];
                },
                op => [ROA.of(op), context]
            )
        )
    }
}

function pushLoopTargets(context: AdaptStatementContext, breakTarget: Operation, continueTarget: Operation): AdaptStatementContext {
    const breakTargets = ROA.prepend(breakTarget)(context.breakTargets);
    const continueTargets = ROA.prepend(continueTarget)(context.continueTargets);
    return { ...context, breakTargets, continueTargets };
}

function popLoopTargets(context: AdaptStatementContext, originalContext: AdaptStatementContext) {
    return { ...context, breakTargets: originalContext.breakTargets, continueTargets: originalContext.continueTargets };
}

function adaptDoStatement(node: tsm.DoStatement): S.State<AdaptStatementContext, readonly Operation[]> {

    return context => {
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;
        const startTarget = { kind: 'noop' } as Operation;
        let $context = pushLoopTargets(context, breakTarget, continueTarget);

        let stmtOps: readonly Operation[];
        [stmtOps, $context] = adaptStatement(node.getStatement())($context);

        const expr = node.getExpression();
        let exprOps: readonly Operation[];
        [exprOps, $context] = adaptExpressionAsBoolean(expr)($context);

        let ops = pipe(
            stmtOps,
            ROA.prepend(startTarget),
            ROA.append(continueTarget),
            ROA.concat(updateLocation(expr)(exprOps)),
            ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget }),
            ROA.append(breakTarget)
        );

        $context = popLoopTargets($context, context);
        return [ops, $context];
    }
}

function adaptWhileStatement(node: tsm.WhileStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;
        let $context = pushLoopTargets(context, breakTarget, continueTarget);

        const expr = node.getExpression();
        let exprOps: readonly Operation[];
        [exprOps, $context] = adaptExpressionAsBoolean(expr)($context);

        let stmtOps: readonly Operation[];
        [stmtOps, $context] = adaptStatement(node.getStatement())($context);

        const ops = pipe(
            exprOps,
            updateLocation(expr),
            ROA.prepend(continueTarget),
            ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget }),
            ROA.concat(stmtOps),
            ROA.append<Operation>({ kind: 'jump', target: continueTarget }),
            ROA.append(breakTarget)
        );

        $context = popLoopTargets($context, context);
        return [ops, $context];
    }
}

function adaptCatchVariableDeclaration(node: tsm.CatchClause) {
    return (context: AdaptStatementContext): AdaptStatementContext => {

        function returnError(message: string) {
            return updateContextErrors(context)(makeParseError(node)(message));
        }

        const decl = node.getVariableDeclaration();
        if (decl) {
            // if there's a variable declaration, update the context scope
            // to include the new variable and update the context locals
            if (decl.getInitializer()) {
                return returnError('catch variable must not have an initializer');
            }

            const name = decl.getNameNode();
            if (!tsm.Node.isIdentifier(name)) {
                return returnError('catch variable must be a simple identifier');
            }

            return pipe(
                E.Do,
                E.bind('symbol', () => TS.parseSymbol(name)),
                E.bind('localvar', ({ symbol }) => E.of(makeLocalVariable(name, symbol, context.locals.length))),
                E.bind('scope', ({ localvar }) => pipe(
                    localvar,
                    ROA.of,
                    updateScope(context.scope),
                    E.mapLeft(error => makeParseError(name)(error))
                )),
                E.match(
                    updateContextErrors(context),
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
            declarations: [{ name: `_anon_error_${Date.now()}`, type: "any", }]
        });

        return pipe(
            varStmt.getDeclarations(),
            ROA.lookup(0),
            O.match(
                () => {
                    const error = makeParseError(node)('failed to retrieve scratch variable declaration');
                    return updateContextErrors(context)(error);
                },
                decl => {
                    const locals = ROA.append({ name: "#error", type: decl.getType() })(context.locals);
                    return ({ ...context, locals });
                }
            )
        )
    }
}

function adaptCatchClause(node: tsm.CatchClause): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        let $context = adaptCatchVariableDeclaration(node)(context);
        let blockOps;
        [blockOps, $context] = adaptBlock(node.getBlock())($context);

        let operations = pipe(
            blockOps,
            ROA.prepend<Operation>({ kind: 'storelocal', index: context.locals.length, location: node.getFirstChildByKind(tsm.SyntaxKind.CatchKeyword) }),
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
            [catchOps, $context] = adaptCatchClause($catch)($context);
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

function adaptInitializer(node?: tsm.VariableDeclarationList | tsm.Expression): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        if (node === undefined) { return [[], context]; }

        if (tsm.Node.isVariableDeclarationList(node)) {
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
        }

        return adaptExpression(node)(context);
    }
}

function adaptIncrementor(node: tsm.ForStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const incr = node.getIncrementor();
        if (incr === undefined) { return [[], context]; }

        let [ops, $context] = adaptExpression(incr)(context);
        ops = updateLocation(incr)(ops);
        return [ops, $context];
    }
}

function adaptCondition(node: tsm.ForStatement, startTarget: Operation): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const cond = node.getCondition();
        if (cond === undefined) {
            const ops = ROA.of<Operation>({ kind: 'jump', target: startTarget });
            return [ops, context];
        }

        let [ops, $context] = adaptExpression(cond)(context);
        ops = pipe(
            ops,
            updateLocation(cond),
            ROA.append<Operation>({ kind: 'jumpif', target: startTarget })
        );

        return [ops, $context];
    }
}

function adaptForStatement(node: tsm.ForStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        const init = node.getInitializer();
        let [ops, $context] = adaptInitializer(init)(context);
        ops = init ? updateLocation(init)(ops) : ops;

        const startTarget = { kind: 'noop' } as Operation;
        const conditionTarget = { kind: 'noop' } as Operation;
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;
        $context = pushLoopTargets(context, breakTarget, continueTarget);

        let stmtOps: readonly Operation[] = ROA.empty;
        [stmtOps, $context] = adaptStatement(node.getStatement())($context);
        ops = pipe(
            ops,
            ROA.append<Operation>({ kind: "jump", target: conditionTarget }),
            ROA.append(startTarget),
            ROA.concat(stmtOps),
            ROA.append(continueTarget)
        );

        let incrOps: readonly Operation[] = ROA.empty;
        [incrOps, $context] = adaptIncrementor(node)($context);
        ops = pipe(
            ops,
            ROA.concat(incrOps),
            ROA.append(conditionTarget)
        )

        let condOps: readonly Operation[] = ROA.empty;
        [condOps, $context] = adaptCondition(node, startTarget)($context);
        ops = pipe(
            ops,
            ROA.concat(condOps),
            ROA.append(breakTarget),
        );

        $context = popLoopTargets($context, context);
        return [ops, $context];
    }
}

function adaptForInStatement(node: tsm.ForInStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        const init = node.getInitializer();
        const expr = node.getExpression();
        const stmt = node.getStatement();

        const error = makeParseError(node)('for in statement not implemented');
        return [ROA.empty, updateContextErrors(context)(error)];
    }
}

function adaptForOfStatement(node: tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        const init = node.getInitializer();
        const expr = node.getExpression();
        const stmt = node.getStatement();

        const error = makeParseError(node)('for in statement not implemented');
        return [ROA.empty, updateContextErrors(context)(error)];
    }
}

function adaptSwitchStatement(node: tsm.SwitchStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const error = makeParseError(node)('switch statement not implemented');
        return [ROA.empty, updateContextErrors(context)(error)];
    }
}

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

const adaptFutureWork =
    (node: tsm.Node): S.State<AdaptStatementContext, readonly Operation[]> =>
        context => {
            const error = makeParseError(node)(`${node.getKindName()} support coming in future release`);
            const errors = ROA.append(error)(context.errors);
            return [ROA.empty, { ...context, errors }];
        }

const adaptDispatchMap: AdaptDispatchMap<readonly Operation[], AdaptStatementContext> = {
    [tsm.SyntaxKind.Block]: adaptBlock,
    [tsm.SyntaxKind.BreakStatement]: adaptBreakStatement,
    [tsm.SyntaxKind.ContinueStatement]: adaptContinueStatement,
    [tsm.SyntaxKind.DoStatement]: adaptDoStatement,
    [tsm.SyntaxKind.EmptyStatement]: adaptEmptyStatement,
    [tsm.SyntaxKind.ExpressionStatement]: adaptExpressionStatement,
    [tsm.SyntaxKind.ForStatement]: adaptForStatement,
    [tsm.SyntaxKind.IfStatement]: adaptIfStatement,
    [tsm.SyntaxKind.ReturnStatement]: adaptReturnStatement,
    [tsm.SyntaxKind.ThrowStatement]: adaptThrowStatement,
    [tsm.SyntaxKind.TryStatement]: adaptTryStatement,
    [tsm.SyntaxKind.VariableStatement]: adaptVariableStatement,
    [tsm.SyntaxKind.WhileStatement]: adaptWhileStatement,

    [tsm.SyntaxKind.SwitchStatement]: adaptFutureWork,
    [tsm.SyntaxKind.ForInStatement]: adaptFutureWork,
    [tsm.SyntaxKind.ForOfStatement]: adaptFutureWork,
}

// Not Supported:
//  * SyntaxKind.ClassDeclaration:
//  * SyntaxKind.DebuggerStatement:
//  * SyntaxKind.EnumDeclaration:
//  * SyntaxKind.ExportAssignment:
//  * SyntaxKind.ExportDeclaration:
//  * SyntaxKind.FunctionDeclaration:
//  * SyntaxKind.ImportDeclaration:
//  * SyntaxKind.ImportEqualsDeclaration:
//  * SyntaxKind.InterfaceDeclaration:
//  * SyntaxKind.LabeledStatement:
//  * SyntaxKind.ModuleBlock:
//  * SyntaxKind.ModuleDeclaration:
//  * SyntaxKind.NotEmittedStatement:
//  * SyntaxKind.TypeAliasDeclaration:
//  * SyntaxKind.WithStatement:

export const dispatchAdapt =
    <A, T extends AdaptDispatchContext>(name: string, dispatchMap: AdaptDispatchMap<A, T>, monoid: MONOID.Monoid<A>) =>
        (node: tsm.Node): S.State<T, A> =>
            (context: T) => {
                const dispatchFunction = dispatchMap[node.getKind()];
                if (dispatchFunction) {
                    return dispatchFunction(node as any)(context);
                } else {
                    const error = makeParseError(node)(`${name} ${node.getKindName()} not supported`);
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
    const context: AdaptStatementContext = {
        scope,
        errors: [],
        locals: [],
        returnTarget: { kind: 'return' },
        breakTargets: [],
        continueTargets: [],
    };

    const [operations, { errors, locals }] = adaptBody(context);
    return ROA.isNonEmpty(errors)
        ? E.left(errors)
        : E.of({
            operations: ROA.append<Operation>(context.returnTarget)(operations),
            locals
        });

    function adaptBody(context: AdaptStatementContext): [readonly Operation[], AdaptStatementContext] {
        if (tsm.Node.isStatement(body)) return adaptStatement(body)(context);
        if (tsm.Node.isExpression(body)) return adaptExpression(body)(context);
        const error = makeParseError(body)(`unexpected body kind ${body.getKindName()}`);
        return [ROA.empty, updateContextErrors(context)(error)];
    }
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
                        E.mapLeft(flow(makeParseError(node), ROA.of))
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

const makeContractMethod =
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
                    S.chain(makeContractMethod(node)),
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
