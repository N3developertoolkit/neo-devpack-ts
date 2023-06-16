import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as TS from '../TS';

import { CompileTimeObject, Scope, createEmptyScope, createScope } from "../types/CompileTimeObject";
import { Operation, getBooleanConvertOps, pushInt, updateLocation } from "../types/Operation";
import { CompileError, E_fromSeparated, ParseError, isVoidLike, makeParseError, updateContextErrors } from "../utils";
import { ContractMethod, ContractVariable } from "../types/CompileOptions";
import { parseExpression, resolveExpression } from "./expressionProcessor";
import { generateStoreOps, updateDeclarationScope, StoreOpVariable, parseVariableDeclaration, ParsedVariable, BoundVariable } from "./parseVariableBinding";
import { start } from "repl";

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

// type UpdateFunction = ([ops, context]: readonly [readonly Operation[], AdaptStatementContext]) => [readonly Operation[], AdaptStatementContext];
// function updateErrors(error: ParseError): UpdateFunction;
// function updateErrors(errors: readonly ParseError[]): UpdateFunction;
// function updateErrors(message: string, node?: tsm.Node): UpdateFunction;
// function updateErrors(args1: string | ParseError | readonly ParseError[], node?: tsm.Node): UpdateFunction {
//     const errors = typeof args1 === 'string' ? makeParseError(node)(args1) : args1;
//     return ([ops, context]) => [ops, updateContextErrors(context)(errors)];
// }

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

function adaptError(error: ParseError): S.State<AdaptStatementContext, readonly Operation[]>;
function adaptError(errors: readonly ParseError[]): S.State<AdaptStatementContext, readonly Operation[]>;
function adaptError(message: string, node?: tsm.Node): S.State<AdaptStatementContext, readonly Operation[]>;
function adaptError(arg1: string | ParseError | readonly ParseError[], node?: tsm.Node): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const errors = typeof arg1 === 'string' ? makeParseError(node)(arg1) : arg1;
        return [ROA.empty, updateContextErrors(context)(errors)];
    }
}

function matchError(context: AdaptStatementContext): (error: ParseError) => [readonly Operation[], AdaptStatementContext];
function matchError(context: AdaptStatementContext): (errors: readonly ParseError[]) => [readonly Operation[], AdaptStatementContext];
function matchError(context: AdaptStatementContext): (message: string, node?: tsm.Node) => [readonly Operation[], AdaptStatementContext];
function matchError(context: AdaptStatementContext): (arg1: string | ParseError | readonly ParseError[], node?: tsm.Node) => [readonly Operation[], AdaptStatementContext] {
    return (arg1, node) => {
        const errors = typeof arg1 === 'string' ? makeParseError(node)(arg1) : arg1;
        return [ROA.empty, updateContextErrors(context)(errors)];
    }
}

function adaptExpression(node: tsm.Expression, convertOps: readonly Operation[] = []): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            node,
            parseExpression(context.scope),
            E.map(ROA.concat(convertOps)),
            E.match(
                matchError(context),
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


function adaptStoreOps(
    node: tsm.VariableDeclaration,
    kind: tsm.VariableDeclarationKind,
    initOps: readonly Operation[] = []
): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const [obj, $context] = pipe(
            initOps,
            parseVariableDeclaration(node, kind),
            E.chain(parsedVariables => {
                const [scope, variables] = updateDeclarationScope(parsedVariables, context.scope, localVariableFactory(context));
                return pipe(
                    variables,
                    ROA.map(c => <StoreOpVariable>{ node: c.cto.node, storeOps: c.cto.storeOps, index: c.index }),
                    generateStoreOps,
                    E.mapLeft(ROA.of),
                    E.map(storeOps => {
                        const locals = pipe(
                            context.locals,
                            ROA.concat(pipe(
                                variables,
                                ROA.map(v => <LocalVariable>{ name: v.name, type: v.cto.node.getType() }),
                            ))
                        )
                        return [storeOps, <AdaptStatementContext>{ ...context, locals, scope }] as const;
                    })
                )
            }),
            E.match(
                error => [ROA.empty, updateContextErrors(context)(error)] as const,
                identity
            )
        )
        return [obj, $context];
    }
}

function adaptVariableDeclaration(node: tsm.VariableDeclaration, kind: tsm.VariableDeclarationKind): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const [ops, $context] = pipe(
            node.getInitializer(),
            O.fromNullable,
            O.map(parseExpression(context.scope)),
            O.getOrElse(() => E.of(ROA.empty as readonly Operation[])),
            E.map(initOps => {
                const [storeOps, $context] = adaptStoreOps(node, kind, initOps)(context);
                // only generate load/store ops if there are new locals
                if (context.locals.length !== $context.locals.length) {
                    // I'm pretty sure empty init or store ops is a compiler bug, so throw instead of returning errors
                    if (ROA.isEmpty(storeOps)) throw new CompileError("No store ops generated for variable declaration", node);
                    if (ROA.isEmpty(initOps)) throw new CompileError("No init ops generated for variable declaration", node);
                    return [ROA.concat(storeOps)(initOps), $context] as const;
                }
                return [ROA.empty, $context] as const;
            }),
            E.match(
                matchError(context),
                identity
            )
        )
        return [ops, $context];
    }
}

function localVariableFactory(context: AdaptStatementContext) {
    return (node: tsm.Identifier, symbol: tsm.Symbol, index: number): CompileTimeObject => {
        const slotIndex = index + context.locals.length;
        const loadOps = ROA.of<Operation>({ kind: "loadlocal", index: slotIndex });
        const storeOps = ROA.of<Operation>({ kind: "storelocal", index: slotIndex });
        return <CompileTimeObject>{ node, symbol, loadOps, storeOps };
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
                () => adaptError('break statement not within a loop', node)(context),
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
                () => adaptError('continue statement not within a loop', node)(context),
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
            adaptInitializer(),
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

        function adaptInitializer(): S.State<AdaptStatementContext, readonly Operation[]> {
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

interface ForEachOptions {
    readonly initOps: (continueTarget: Operation) => readonly Operation[];
    readonly startOps: readonly Operation[];
    readonly continueOps: (startTarget: Operation) => readonly Operation[];
}

function adaptForEach(node: tsm.ForInStatement | tsm.ForOfStatement, options: ForEachOptions): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        // save the original scope so it can be swapped back in at the end of the block
        let scope = context.scope;

        const startTarget = { kind: 'noop' } as Operation;
        // const conditionTarget = { kind: 'noop' } as Operation; // no condition target for iterator flavors
        const breakTarget = { kind: 'noop' } as Operation;
        const continueTarget = { kind: 'noop' } as Operation;

        return pipe(
            context,
            pushLoopTargets(breakTarget, continueTarget),
            adaptExpression(node.getExpression()),
            // InsertSequencePoint(syntax.ForEachKeyword)
            updateOps(ROA.concat(options.initOps(continueTarget))),
            // InsertSequencePoint(syntax.Identifier / syntax.Variable)
            updateOps(ROA.concat(
                pipe(
                    options.startOps,
                    ROA.prepend(startTarget),
                    updateLocation(node.getExpression()),
                )
            )),
            updateOps(ROA.concat(options.startOps)),
            updateContext(adaptInitializer()),
            updateContext(adaptStatement(node.getStatement())),
            updateOps(ROA.concat(
                pipe(
                    options.continueOps(startTarget),
                    ROA.prepend(continueTarget),
                    updateLocation(node.getInitializer()),
                )
            )),
            updateOps(ROA.append(breakTarget)),
            popLoopTargets(context),
            // swap original scope back in
            updateContextScope(scope)
        );

        function adaptInitializer(): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                const init = node.getInitializer();
                if (tsm.Node.isVariableDeclarationList(init)) {
                    // TS AST ensures there is exactly one declaration
                    const decl = init.getDeclarations()[0];
                    const kind = init.getDeclarationKind();
                    return adaptStoreOps(decl, kind)(context);
                }
                return pipe(
                    init,
                    resolveExpression(context.scope),
                    E.chain(ctx => ctx.getStoreOps()),
                    E.match(
                        matchError(context),
                        storeOps => [storeOps, context]
                    )
                );
            }

        }
    }
}

function adaptForEachIterator(node: tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        let iteratorVar: number;
        [iteratorVar, context] = adaptAnonymousVariable(context);

        // on initialization, store the iterator in an anonymous variable
        const initOps = (continueTarget: Operation) => ROA.fromArray<Operation>([
            { kind: "storelocal", index: iteratorVar },
            { kind: "jump", target: continueTarget },
        ]);

        // on start, load the iterator and call iterator.value
        const startOps = ROA.fromArray<Operation>([
            { kind: "loadlocal", index: iteratorVar },
            { kind: "syscall", name: "System.Iterator.Value" }
        ]);

        // on continue, load the iterator, call iterator.next, and jump if the result is true
        const continueOps = (startTarget: Operation) => ROA.fromArray<Operation>([
            { kind: "loadlocal", index: iteratorVar },
            { kind: "syscall", name: "System.Iterator.Next" },
            { kind: "jumpif", target: startTarget },
        ]);

        const options = { initOps, startOps, continueOps };
        return adaptForEach(node, options)(context);
    }
}

function adaptForEachArray(node: tsm.ForInStatement | tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        let arrayVar: number, lengthVar: number, indexVar: number;
        [arrayVar, context] = adaptAnonymousVariable(context);
        [lengthVar, context] = adaptAnonymousVariable(context);
        [indexVar, context] = adaptAnonymousVariable(context);

        const conditionTarget = { kind: 'noop' } as Operation;

        // on initialization, store the array, it's length and the current index in anonymous vars
        const initOps = (_continueTarget: Operation) => ROA.fromArray<Operation>([
            { kind: 'duplicate' },
            { kind: "storelocal", index: arrayVar },
            { kind: "size" },
            { kind: "storelocal", index: lengthVar },
            pushInt(0),
            { kind: "storelocal", index: indexVar },
            { kind: "jump", target: conditionTarget },
        ]);

        // on start, load the current item (if for-of) or current index (if for-in)
        const startOps = tsm.Node.isForOfStatement(node)
            ? ROA.fromArray<Operation>([
                { kind: "loadlocal", index: arrayVar },
                { kind: "loadlocal", index: indexVar },
                { kind: "pickitem" },
            ])
            : ROA.of<Operation>({ kind: "loadlocal", index: indexVar });

        // on continue, increment the index then jump to start if index is less than length
        const continueOps = (startTarget: Operation) => ROA.fromArray<Operation>([
            { kind: "loadlocal", index: indexVar },
            { kind: "increment" },
            { kind: "storelocal", index: indexVar },
            conditionTarget,
            { kind: "loadlocal", index: indexVar },
            { kind: "loadlocal", index: lengthVar },
            { kind: "jumplt", target: startTarget },
        ]);

        const options = { initOps, startOps, continueOps };
        return adaptForEach(node, options)(context);
    }
}
function adaptForInStatement(node: tsm.ForInStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const expr = node.getExpression();
        const exprType = expr.getType();

        if (exprType.isArray()) return adaptForEachArray(node)(context);

        return adaptError(`adaptForInStatement not implemented for ${exprType.getSymbol()?.getName ?? exprType.getText()}`, node)(context);
    }
}

function adaptForOfStatement(node: tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const expr = node.getExpression();
        const exprType = expr.getType();

        if (exprType.isArray()) return adaptForEachArray(node)(context);

        // TODO detect if expr implements Iterator
        const isIterator = false;
        if (isIterator) return adaptForEachIterator(node)(context);

        return adaptError(`adaptForOfStatement not implemented for ${exprType.getSymbol()?.getName ?? exprType.getText()}`, node)(context);
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
            case tsm.SyntaxKind.ForInStatement: return adaptForInStatement(node as tsm.ForInStatement)(context);
            case tsm.SyntaxKind.ForOfStatement: return adaptForOfStatement(node as tsm.ForOfStatement)(context);
            case tsm.SyntaxKind.ForStatement: return adaptForStatement(node as tsm.ForStatement)(context);
            case tsm.SyntaxKind.IfStatement: return adaptIfStatement(node as tsm.IfStatement)(context);
            case tsm.SyntaxKind.ReturnStatement: return adaptReturnStatement(node as tsm.ReturnStatement)(context);
            case tsm.SyntaxKind.ThrowStatement: return adaptThrowStatement(node as tsm.ThrowStatement)(context);
            case tsm.SyntaxKind.TryStatement: return adaptTryStatement(node as tsm.TryStatement)(context);
            case tsm.SyntaxKind.VariableStatement: return adaptVariableDeclarationList((node as tsm.VariableStatement).getDeclarationList())(context);
            case tsm.SyntaxKind.WhileStatement: return adaptWhileStatement(node as tsm.WhileStatement)(context);
            case tsm.SyntaxKind.SwitchStatement:
                return adaptError(`adaptStatement ${node.getKindName()} support coming in future release`, node)(context);
            default:
                return adaptError(`adaptStatement ${node.getKindName()} not supported`, node)(context);
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
        return adaptError(`unexpected body kind ${body.getKindName()}`, body)(context);
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
