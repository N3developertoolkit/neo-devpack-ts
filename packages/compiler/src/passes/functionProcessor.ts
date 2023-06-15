import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as TS from '../TS';

import { CompileTimeObject, Scope, createEmptyScope, createScope } from "../types/CompileTimeObject";
import { Operation, getBooleanConvertOps, updateLocation } from "../types/Operation";
import { E_fromSeparated, ParseError, isVoidLike, makeParseError, updateContextErrors } from "../utils";
import { ContractMethod, ContractVariable } from "../types/CompileOptions";
import { parseExpression } from "./expressionProcessor";
import { parseVariableDeclaration, generateStoreOps, updateDeclarationScope, StoreOpVariable } from "./parseVariableBinding";

function adaptOp(op: Operation): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => [ROA.of(op), context];
}

function updateContext(func: S.State<AdaptStatementContext, readonly Operation[]>) {
    return (
        [ops, context]: readonly [readonly Operation[], AdaptStatementContext]
    ): [readonly Operation[], AdaptStatementContext] => {
        const [$ops, $context] = func(context);
        return [ROA.concat($ops)(ops), $context];
    }
}

function updateOps(func: (ops: readonly Operation[]) => readonly Operation[]) {
    return (
        [ops, context]: readonly [readonly Operation[], AdaptStatementContext]
    ): [readonly Operation[], AdaptStatementContext] => {
        return [func(ops), context];
    }
}


function updateContextScope(scope: Scope) {
    return (
        [ops, context]: readonly [readonly Operation[], AdaptStatementContext]
    ): [readonly Operation[], AdaptStatementContext] => {
        return [ops, { ...context, scope }];
    }
}

function dropIfVoidOps(type: tsm.Type) {
    return (ops: readonly Operation[]): readonly Operation[] => {
        return isVoidLike(type) ? ops : pipe(ops, ROA.append<Operation>({ kind: 'drop' }));
    }
}

function pushLoopTargets(breakTarget: Operation, continueTarget: Operation) {
    return (context: AdaptStatementContext): AdaptStatementContext => {
        const breakTargets = ROA.prepend(breakTarget)(context.breakTargets);
        const continueTargets = ROA.prepend(continueTarget)(context.continueTargets);
        return { ...context, breakTargets, continueTargets };
    }
}

function popLoopTargets(originalContext: AdaptStatementContext) {
    return (
        [ops, context]: readonly [readonly Operation[], AdaptStatementContext]
    ): [readonly Operation[], AdaptStatementContext] => {
        return [ops, { ...context, breakTargets: originalContext.breakTargets, continueTargets: originalContext.continueTargets }];
    }
}

function reduceAdaptations(context: AdaptStatementContext, ops: readonly Operation[] = ROA.empty) {
    return (
        adapts: readonly S.State<AdaptStatementContext, readonly Operation[]>[]
    ): [readonly Operation[], AdaptStatementContext] => {
        const [$ops, $context] = pipe(
            adapts,
            ROA.reduce([ops, context] as const, (state, func) => updateContext(func)(state))
        )
        return [$ops, $context];
    }
}

function adaptAnonymousVariable(context: AdaptStatementContext): [number, AdaptStatementContext] {
    const index = context.locals.length;
    const locals = pipe(context.locals, ROA.append<LocalVariable>({ name: `#var${index}` }))
    return [index, { ...context, locals }];
}

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

function adaptBlock(node: tsm.Block): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        // save the original scope so it can be swapped back in at the end of the block
        let scope = context.scope;
        // swap in a new empty scope for the block 
        context = { ...context, scope: createEmptyScope(context.scope) };

        return pipe(
            node.getStatements(),
            ROA.map(adaptStatement),
            reduceAdaptations(context),
            updateOps(ops => {
                const open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
                return open ? ROA.prepend<Operation>({ kind: 'noop', location: open })(ops) : ops;
            }),
            updateOps(ops => {
                const close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
                return close ? ROA.append<Operation>({ kind: 'noop', location: close })(ops) : ops;
            }),
            // swap original scope back in
            updateContextScope(scope)
        )
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
            O.map(expr => adaptExpression(expr)(context)),
            O.getOrElse(() => [ROA.empty as readonly Operation[], context] as const),
            updateOps(flow(
                ROA.append<Operation>({ kind: 'jump', target: context.returnTarget }),
                updateLocation(node)
            ))
        )
    };
}

function adaptThrowStatement(node: tsm.ThrowStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            context,
            adaptExpression(node.getExpression()),
            updateOps(flow(
                ROA.append<Operation>({ kind: 'throw' }),
                updateLocation(node)
            ))
        )
    }
}

function adaptExpressionStatement(node: tsm.ExpressionStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    const expr = node.getExpression();
    return context => {
        return pipe(
            context,
            adaptExpression(expr),
            updateOps(flow(
                dropIfVoidOps(expr.getType()),
                updateLocation(node),
            ))
        )
    }
}

function adaptIfStatement(node: tsm.IfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const elseTarget = { kind: 'noop' } as Operation;
        const expr = node.getExpression();
        return pipe(
            context,
            adaptExpression(expr, getBooleanConvertOps(expr.getType())),
            updateOps(ops => {
                const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
                return pipe(
                    ops,
                    ROA.append<Operation>({ kind: 'jumpifnot', target: elseTarget }),
                    updateLocation(closeParen ? { start: node, end: closeParen } : expr)
                )
            }),
            updateContext(adaptStatement(node.getThenStatement())),
            updateContext((context) => {
                const $else = node.getElseStatement();
                if ($else) {
                    const endTarget = { kind: 'noop' } as Operation;
                    return pipe(
                        context,
                        adaptStatement($else),
                        updateOps(elseOps => pipe(
                            <Operation>{ kind: 'jump', target: endTarget },
                            ROA.of,
                            ROA.append(elseTarget),
                            ROA.concat(elseOps),
                            ROA.append(endTarget)
                        ))
                    )
                } else {
                    return [ROA.of(elseTarget), context];
                }
            })
        )
    }
}

function adaptVariableDeclaration(node: tsm.VariableDeclaration, kind: tsm.VariableDeclarationKind): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            node,
            parseVariableDeclaration(context.scope, kind),
            E.bindTo('parsedVariables'),
            E.bind('initOps', () => pipe(
                node.getInitializer(),
                O.fromNullable,
                O.map(parseExpression(context.scope)),
                O.getOrElse(() => E.of(ROA.empty as readonly Operation[])),
                E.mapLeft(ROA.of)
            )),
            E.match(
                errors => [ROA.empty, updateContextErrors(context)(errors)],
                ({ initOps, parsedVariables }) => {
                    const { scope, variables } = updateDeclarationScope(parsedVariables, context.scope, localVariableFactory(context));
                    return pipe(
                        variables,
                        ROA.map(c => <StoreOpVariable>{ node: c.cto.node, storeOps: c.cto.storeOps, index: c.index }),
                        generateStoreOps,
                        E.map(storeOps => {
                            // if updateDeclarationScope returns no variables, don't return any init or store ops
                            return ROA.isEmpty(variables) ? ROA.empty : ROA.concat(storeOps)(initOps);
                        }),
                        E.match(
                            error => [ROA.empty, updateContextErrors(context)(error)],
                            ops => {
                                const locals = pipe(
                                    context.locals,
                                    ROA.concat(pipe(
                                        variables,
                                        ROA.map(v => <LocalVariable>{ name: v.name, type: v.cto.node.getType() }),
                                    ))
                                )
                                return [ops, { ...context, scope, locals }];
                            }
                        )
                    )
                }
            )
        )
    }

    function localVariableFactory(context: AdaptStatementContext) {
        return (node: tsm.Identifier, symbol: tsm.Symbol, index: number): CompileTimeObject => {
            const slotIndex = index + context.locals.length;
            const loadOps = ROA.of<Operation>({ kind: "loadlocal", index: slotIndex });
            const storeOps = ROA.of<Operation>({ kind: "storelocal", index: slotIndex });
            return <CompileTimeObject>{ node, symbol, loadOps, storeOps };
        }
    }
}

function adaptVariableDeclarationList(node: tsm.VariableDeclarationList): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const kind = node.getDeclarationKind();
        return pipe(
            node.getDeclarations(),
            ROA.map(decl => adaptVariableDeclaration(decl, kind)),
            reduceAdaptations(context),
        )
    }
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
                    const error = makeParseError(node)('continue statement not within a loop');
                    return [ROA.empty, updateContextErrors(context)(error)];
                },
                op => [ROA.of(op), context]
            )
        )
    }
}

function adaptDoStatement(node: tsm.DoStatement): S.State<AdaptStatementContext, readonly Operation[]> {

    return context => {

        const breakTarget = <Operation>{ kind: 'noop' };
        const continueTarget = <Operation>{ kind: 'noop' };
        const startTarget = <Operation>{ kind: 'noop' };
        const expr = node.getExpression();

        return pipe(
            context,
            pushLoopTargets(breakTarget, continueTarget),
            adaptOp(startTarget),
            updateContext(adaptStatement(node.getStatement())),
            updateOps(ROA.append(continueTarget)),
            updateContext(flow(
                adaptExpression(expr, getBooleanConvertOps(expr.getType())),
                updateOps(updateLocation(expr))
            )),
            updateOps(ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget })),
            updateOps(ROA.append(breakTarget)),
            popLoopTargets(context)
        );
    }
}

function adaptWhileStatement(node: tsm.WhileStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const expr = node.getExpression();
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;

        return pipe(
            context,
            pushLoopTargets(breakTarget, continueTarget),
            adaptExpression(expr, getBooleanConvertOps(expr.getType())),
            updateOps(updateLocation(expr)),
            updateOps(ROA.prepend(continueTarget)),
            updateOps(ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget })),
            updateContext(adaptStatement(node.getStatement())),
            updateOps(ROA.append<Operation>({ kind: 'jump', target: continueTarget })),
            updateOps(ROA.append(breakTarget)),
        )
    }
}


function adaptTryStatement(node: tsm.TryStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const catchTarget = { kind: 'noop' } as Operation;
        const finallyTarget = { kind: 'noop' } as Operation;
        const endTarget = { kind: 'noop' } as Operation;

        return pipe(
            context,
            adaptOp({ kind: 'try', catchTarget, finallyTarget }),
            updateContext(adaptBlock(node.getTryBlock())),
            updateOps(ROA.append<Operation>({ kind: 'endtry', target: endTarget })),
            updateContext(adaptCatchClause(catchTarget, node.getCatchClause())),
            updateContext(adaptFinallyBlock(finallyTarget, node.getFinallyBlock())),
            updateOps(ROA.append(endTarget)),
        )

        function adaptCatchClause(target: Operation, node?: tsm.CatchClause): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                if (!node) return [ROA.empty, context];

                // save the original scope so it can be swapped back in at the end of the block
                let scope = context.scope;
                return pipe(
                    context,
                    adaptCatchVariableDeclaration(node),
                    ([index, context]) => {
                        return pipe(
                            context,
                            adaptBlock(node.getBlock()),
                            updateOps(ROA.prepend<Operation>({
                                kind: 'storelocal',
                                index,
                                location: node.getFirstChildByKind(tsm.SyntaxKind.CatchKeyword)
                            })),
                            // in NCCS, the catch target is the catch variable storelocal operation above
                            // rather than replumb the code to know the storelocal operation when the 
                            // try clause is emitted, prepend the noop catch target here instead.
                            updateOps(ROA.prepend<Operation>(target))
                        )
                    },
                    // swap original scope back in
                    updateContextScope(scope)
                )
            }

            function adaptCatchVariableDeclaration(node: tsm.CatchClause): S.State<AdaptStatementContext, number> {
                return context => {
                    const decl = node.getVariableDeclaration();

                    // if there is no declaration, create an anonymous variable to hold the error
                    if (!decl) return adaptAnonymousVariable(context);

                    const slotIndex = context.locals.length;
                    const makeErrorResult = (message: string): [number, AdaptStatementContext] => {
                        context = updateContextErrors(context)(makeParseError(node)(message));
                        return [slotIndex, context];
                    }

                    if (decl.getInitializer()) return makeErrorResult("catch variable must not have an initializer");
                    const name = decl.getNameNode();
                    if (!tsm.Node.isIdentifier(name)) return makeErrorResult("catch variable must be a simple identifier");

                    context = pipe(
                        name,
                        TS.parseSymbol,
                        E.match(
                            updateContextErrors(context),
                            symbol => {
                                // create a compile time object for the catch variable
                                const loadOps = ROA.of(<Operation>{ kind: "loadlocal", index: slotIndex });
                                const storeOps = ROA.of(<Operation>{ kind: "storelocal", index: slotIndex });
                                const cto = <CompileTimeObject>{ node: name, symbol: symbol, loadOps, storeOps };

                                // update the context with the catch variable
                                const locals = ROA.append<LocalVariable>({ name: symbol.getName(), type: name.getType() })(context.locals);

                                // create a new scope to hold the catch variable
                                const scope = createScope(context.scope)([cto]);

                                return { ...context, scope, locals };
                            }
                        )
                    );
                    return [slotIndex, context];
                }
            }
        }

        function adaptFinallyBlock(target: Operation, node?: tsm.Block): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                return node
                    ? pipe(
                        context,
                        adaptOp(target),
                        updateContext(adaptBlock(node)),
                        updateOps(ROA.append<Operation>({ kind: 'endfinally' }))
                    )
                    : [ROA.empty, context];
            }
        }
    }
}

function adaptForInitializer(node: tsm.ForStatement | tsm.ForInStatement | tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const init = node.getInitializer();
        const [ops, $context] = init === undefined
            ? [ROA.empty, context]
            : tsm.Node.isVariableDeclarationList(init)
                ? pipe(
                    context, 
                    adaptVariableDeclarationList(init)
                )
                : pipe(
                    context,
                    adaptExpression(init),
                    updateOps(dropIfVoidOps(init.getType())),
                );

        return init ? [updateLocation(init)(ops), $context] : [ops, $context];
    }
}

function adaptForStatement(node: tsm.ForStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        // save the original scope so it can be swapped back in at the end of the block
        let scope = context.scope;

        const startTarget = { kind: 'noop' } as Operation;
        const conditionTarget = { kind: 'noop' } as Operation;
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;

        return pipe(
            context,
            pushLoopTargets(breakTarget, continueTarget),
            adaptForInitializer(node),
            updateOps(ROA.append<Operation>({ kind: "jump", target: conditionTarget })),
            updateOps(ROA.append(startTarget)),
            updateContext(adaptStatement(node.getStatement())),
            updateOps(ROA.append(continueTarget)),
            updateContext(adaptIncrementor()),
            updateOps(ROA.append(conditionTarget)),
            updateContext(adaptCondition(startTarget)),
            updateOps(ROA.append(breakTarget)),
            popLoopTargets(context),
            // swap original scope back in
            updateContextScope(scope)
        )

        function adaptIncrementor(): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                const incr = node.getIncrementor();
                return incr
                    ? pipe(
                        context,
                        adaptExpression(incr),
                        updateOps(updateLocation(incr))
                    )
                    : [ROA.empty, context];
            }
        }

        function adaptCondition(startTarget: Operation): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                const condition = node.getCondition();
                return condition 
                    ? pipe(
                        context,
                        adaptExpression(condition),
                        updateOps(updateLocation(condition)),
                        updateOps(ROA.append<Operation>({ kind: 'jumpif', target: startTarget }))
                    )
                    : [ROA.of<Operation>({ kind: 'jump', target: startTarget }), context];
            }
        }
    }
}

function adaptForOfStatement(node: tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        // save the original scope so it can be swapped back in at the end of the block
        let scope = context.scope;

        const expr = node.getExpression();
        const exprType = expr.getType();
        if (!exprType.isArray()) {
            return adaptError(`unsupported for-of type ${exprType.getSymbol()?.getName()}`, node)(context);
        }

        const startTarget = { kind: 'noop' } as Operation;
        const conditionTarget = { kind: 'noop' } as Operation;
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;

        let arrayIndex, lengthIndex, iIndex;
        [arrayIndex, context] = adaptAnonymousVariable(context);
        [lengthIndex, context] = adaptAnonymousVariable(context);
        [iIndex, context] = adaptAnonymousVariable(context);


        const q =  pipe(
            context,
            pushLoopTargets(breakTarget, continueTarget),
            adaptForInitializer(node),

        );

        // let $context = pushLoopTargetsOLD(context, breakTarget, continueTarget);
        // let storeOps;
        // [storeOps, $context] = adaptForInitializer(node)(context);

        // const q = pipe(
        //     expr,
        //     parseExpression(context.scope)
        // )

        // let arrayIndex: number, lengthIndex: number, iIndex: number, elementIndex: number;
        // [arrayIndex, $context] = adaptAnonymousVariable($context);
        // [lengthIndex, $context] = adaptAnonymousVariable($context);
        // [iIndex, $context] = adaptAnonymousVariable($context);
        // [elementIndex, $context] = adaptAnonymousVariable($context);

        // if ($context.errors.length > 0) return [ROA.empty, $context];

        return adaptError(`adaptForOfStatement not implemented`, node)(context);
    }
}

function adaptError(message: string, node: tsm.Node): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const error = makeParseError(node)(message);
        const errors = ROA.append(error)(context.errors);
        return [ROA.empty, { ...context, errors }];
    }
}

export interface LocalVariable {
    name: string;
    type?: tsm.Type;
}

export interface AdaptStatementContext {
    readonly errors: readonly ParseError[];
    readonly locals: readonly LocalVariable[];
    readonly scope: Scope;
    readonly returnTarget: Operation;
    readonly breakTargets: readonly Operation[];
    readonly continueTargets: readonly Operation[];
}

export function adaptStatement(node: tsm.Statement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        switch (node.getKind()) {
            case tsm.SyntaxKind.Block: return adaptBlock(node as tsm.Block)(context);
            case tsm.SyntaxKind.BreakStatement: return adaptBreakStatement(node as tsm.BreakStatement)(context);
            case tsm.SyntaxKind.ContinueStatement: return adaptContinueStatement(node as tsm.ContinueStatement)(context);
            case tsm.SyntaxKind.DoStatement: return adaptDoStatement(node as tsm.DoStatement)(context);
            case tsm.SyntaxKind.EmptyStatement: return adaptEmptyStatement(node as tsm.EmptyStatement)(context);
            case tsm.SyntaxKind.ExpressionStatement: return adaptExpressionStatement(node as tsm.ExpressionStatement)(context);
            case tsm.SyntaxKind.ForOfStatement: return adaptForOfStatement(node as tsm.ForOfStatement)(context);
            case tsm.SyntaxKind.ForStatement: return adaptForStatement(node as tsm.ForStatement)(context);
            case tsm.SyntaxKind.IfStatement: return adaptIfStatement(node as tsm.IfStatement)(context);
            case tsm.SyntaxKind.ReturnStatement: return adaptReturnStatement(node as tsm.ReturnStatement)(context);
            case tsm.SyntaxKind.ThrowStatement: return adaptThrowStatement(node as tsm.ThrowStatement)(context);
            case tsm.SyntaxKind.TryStatement: return adaptTryStatement(node as tsm.TryStatement)(context);
            case tsm.SyntaxKind.VariableStatement: return adaptVariableDeclarationList((node as tsm.VariableStatement).getDeclarationList())(context);
            case tsm.SyntaxKind.WhileStatement: return adaptWhileStatement(node as tsm.WhileStatement)(context);
            case tsm.SyntaxKind.ForInStatement:
            case tsm.SyntaxKind.SwitchStatement: {
                const error = makeParseError(node)(`adaptStatement ${node.getKindName()} support coming in future release`);
                const errors = ROA.append(error)(context.errors);
                return [ROA.empty, { ...context, errors }];
            }
            default: {
                const error = makeParseError(node)(`adaptStatement ${node.getKindName()} not supported`);
                const errors = ROA.append(error)(context.errors);
                return [ROA.empty, { ...context, errors }];
            }
        }
    }
}

interface ParseBodyResult {
    readonly operations: readonly Operation[];
    readonly locals: readonly ContractVariable[];
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
            locals: pipe(
                locals,
                ROA.mapWithIndex((index, local) => [index, local] as const),
                ROA.filter(([, local]) => local.type !== undefined),
                ROA.map(([index, local]) => ({ name: local.name, type: local.type!, index }))
            )
        });

    function adaptBody(context: AdaptStatementContext): [readonly Operation[], AdaptStatementContext] {
        if (tsm.Node.isStatement(body)) return adaptStatement(body)(context);
        if (tsm.Node.isExpression(body)) return adaptExpression(body)(context);
        const error = makeParseError(body)(`unexpected body kind ${body.getKindName()}`);
        return [ROA.empty, updateContextErrors(context)(error)];
    }
}

function parseFunctionDeclaration(parentScope: Scope) {
    return (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ParseBodyResult> => {
        return pipe(
            node.getParameters(),
            ROA.mapWithIndex((index, node) => {
                return pipe(
                    node,
                    TS.parseSymbol,
                    E.map(symbol => {
                        const loadOps = ROA.of(<Operation>{ kind: "loadarg", index: index });
                        const storeOps = ROA.of(<Operation>{ kind: "storearg", index: index });
                        return <CompileTimeObject>{ node, symbol, loadOps, storeOps };
                    })
                )
            }),
            ROA.separate,
            E_fromSeparated,
            // Note, not using hoistDeclarations here because none of the hoisted declarations
            // are supported inside functions at this time
            E.map(params => createScope(parentScope)(params)),
            E.bindTo('scope'),
            E.bind('body', () => pipe(
                node.getBody(),
                E.fromNullable(makeParseError(node)("undefined body")),
                E.mapLeft(ROA.of)
            )),
            E.chain(parseBody),
            E.map(({ locals, operations }) => {
                const paramCount = node.getParameters().length;
                if (paramCount > 0 || locals.length > 0) {
                    operations = ROA.prepend<Operation>({ kind: 'initslot', locals: locals.length, params: paramCount })(operations);
                }
                return <ParseBodyResult>{ locals, operations };
            }),
        );
    }
}

function makeContractMethod(node: tsm.FunctionDeclaration) {
    return ({ locals, operations }: ParseBodyResult): E.Either<readonly ParseError[], ContractMethod> => {
        return pipe(
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
            E.mapLeft(ROA.of)
        )
    }
}

export function parseContractMethod(parentScope: Scope) {
    return (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ContractMethod> => {
        return pipe(
            node,
            parseFunctionDeclaration(parentScope),
            E.chain(makeContractMethod(node))
        );
    };
}
