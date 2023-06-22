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
import { generateStoreOps, updateDeclarationScope, StoreOpVariable, parseVariableDeclaration } from "./parseVariableBinding";

export interface LocalVariable {
    readonly name: string;
    readonly type?: tsm.Type;
}

export interface AdaptStatementContext {
    readonly errors: readonly ParseError[];
    readonly locals: readonly LocalVariable[];
    readonly scope: Scope;
    readonly returnTarget: Operation;
    readonly environStack: readonly StatementEnviron[];
}

// some statements affect the code generation of other statements. Examples:
//  - break/continue statements inside loops
//  - break statements inside switch statements
//  - return statement instide try or catch blocks
//  - break statement inside an arbitrary block
// in the devpack-TS codebase, these are called "environs" (didn't want to use "context" again)

type StatementEnviron =
    LabelEnviron |
    LoopEnviron |
    SwitchEnviron |
    TryCatchEnviron;

interface LabelEnviron {
    readonly kind: 'label';
    readonly breakTarget: Operation;
    readonly label: string;
}

interface LoopEnviron {
    readonly kind: 'loop';
    readonly breakTarget: Operation;
    readonly continueTarget: Operation;
    readonly label?: string;
}

interface SwitchEnviron {
    readonly kind: 'switch';
    readonly breakTarget: Operation;
    readonly label?: string;
}

interface TryCatchEnviron {
    readonly kind: 'try-catch';
}

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

type LoopNode = tsm.DoStatement | tsm.WhileStatement | tsm.ForInStatement | tsm.ForOfStatement | tsm.ForStatement;

function pushLoopEnviron(breakTarget: Operation, continueTarget: Operation, node: LoopNode) {
    return (context: AdaptStatementContext): AdaptStatementContext => {
        const label = node.getParentIfKind(tsm.SyntaxKind.LabeledStatement)?.getText();
        const environ: LoopEnviron = {
            kind: 'loop',
            breakTarget,
            continueTarget,
            label
        }
        const environs = ROA.prepend<StatementEnviron>(environ)(context.environStack);
        return { ...context, environStack: environs };
    }
}

function pushLabelEnviron(breakTarget: Operation, node: tsm.LabeledStatement) {
    return (context: AdaptStatementContext): AdaptStatementContext => {
        const label = node.getLabel().getText();
        const environ: LabelEnviron = { kind: 'label', breakTarget, label }
        const environs = ROA.prepend<StatementEnviron>(environ)(context.environStack);
        return { ...context, environStack: environs };
    }
}

function pushSwitchEnviron(breakTarget: Operation, node: tsm.SwitchStatement) {
    return (context: AdaptStatementContext): AdaptStatementContext => {
        const label = node.getParentIfKind(tsm.SyntaxKind.LabeledStatement)?.getText();
        const environ: SwitchEnviron = { kind: 'switch', breakTarget, label }
        const environs = ROA.prepend<StatementEnviron>(environ)(context.environStack);
        return { ...context, environStack: environs };
    }
}

function pushTryCatchEnviron(context: AdaptStatementContext): AdaptStatementContext {
    const environ: TryCatchEnviron = {
        kind: 'try-catch'
    }
    const environs = ROA.prepend<StatementEnviron>(environ)(context.environStack);
    return { ...context, environStack: environs };
}

function popEnviron(originalContext: AdaptStatementContext) {
    return (
        [ops, context]: readonly [readonly Operation[], AdaptStatementContext]
    ): [readonly Operation[], AdaptStatementContext] => {
        return [ops, { ...context, environStack: originalContext.environStack }];
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

function isLoopStatement(node: tsm.Statement) {
    switch (node.getKind()) {
        case tsm.SyntaxKind.ForStatement:
        case tsm.SyntaxKind.ForInStatement:
        case tsm.SyntaxKind.ForOfStatement:
        case tsm.SyntaxKind.WhileStatement:
        case tsm.SyntaxKind.DoStatement:
            return true;
        default:
            return false;
    }
}

function adaptLabeledStatement(node: tsm.LabeledStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        // labels on loop statements are handled by pushLoopEnviron, so ignore them here
        const stmt = node.getStatement();
        if (isLoopStatement(stmt)) { return [ROA.empty, context]; }

        const label = node.getLabel().getText();
        const breakTarget = { kind: 'noop', debug: `breakTarget ${label}` } as Operation;

        return pipe(
            context,
            pushLabelEnviron(breakTarget, node),
            adaptStatement(node.getStatement()),
            updateOps(ROA.append(breakTarget)),
            popEnviron(context)
        )
    }
}

function adaptEmptyStatement(node: tsm.EmptyStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => [ROA.of({ kind: 'noop', location: node }), context];
}

// break/continue/return jump ops are created differs based on the try/catch block(s) the statement is nested inside
function makeTryCatchJumpOps(target: Operation) {
    return (environs: readonly StatementEnviron[]) => {
        return pipe(
            environs,
            // filter down to just the try-catch environs
            ROA.filter(env => env.kind === 'try-catch'),
            ROA.matchRight(
                // if the statement is not nested inside any try/catch blocks, emit a jump to the return target
                () => ROA.of<Operation>({ kind: 'jump', target }),
                (init, _last) => {
                    return pipe(
                        init,
                        // for each nested trycatch block except the last, emit an endtry targeting the next operation
                        ROA.chain(_environ => ROA.of<Operation>({ kind: 'endtry', offset: 1 })),
                        // for the last nested trycatch block, emit an endtry to the return target
                        ROA.append<Operation>({ kind: 'endtry', target }),
                    )
                },
            )
        )
    }
}

function adaptReturnStatement(node: tsm.ReturnStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const returnTargetOps = pipe(
            context.environStack,
            makeTryCatchJumpOps(context.returnTarget)
        );

        return pipe(
            node.getExpression(),
            O.fromNullable,
            O.map(expr => adaptExpression(expr)(context)),
            O.getOrElse(() => [ROA.empty as readonly Operation[], context] as const),
            updateOps(flow(
                ROA.concat(returnTargetOps),
                updateLocation(node)
            ))
        )
    };
}

function adaptBreakStatement(node: tsm.BreakStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        return pipe(
            context.environStack,
            // add index to each environ so we can find any try/catch blocks that need to be ended
            ROA.mapWithIndex((i, env) => [i, env] as const),
            // find the first loop, label or switch 
            ROA.findFirstMap(asBreakTarget),
            O.match(
                () => {
                    const error = makeParseError(node)(`break statement not within a loop, switch or label statement`);
                    return [ROA.empty, updateContextErrors(context)(error)];
                },
                ([i, target]) => {
                    return pipe(
                        context.environStack,
                        ROA.takeLeft(i),
                        makeTryCatchJumpOps(target),
                        updateLocation(node),
                        (ops) => [ops, context]
                    );
                }
            )
        );
    }

    function asBreakTarget([i, env]: readonly [number, StatementEnviron]): O.Option<readonly [number, Operation]> {
        const label = node.getLabel()?.getText();
        if (env.kind === 'loop' && (!label || (env.label === label))) return O.some([i, env.breakTarget]);
        if (env.kind === 'label' && (!label || (env.label === label))) return O.some([i, env.breakTarget]);
        if (env.kind === 'switch' && (!label || (env.label === label))) return O.some([i, env.breakTarget]);
        return O.none;
    }
}

function adaptContinueStatement(node: tsm.ContinueStatement): S.State<AdaptStatementContext, readonly Operation[]> {

    return context => {
        return pipe(
            context.environStack,
            ROA.mapWithIndex((i, env) => [i, env] as const),
            ROA.findFirstMap(asContinueTarget),
            O.match(
                () => {
                    const error = makeParseError(node)(`continue statement not within a loop`);
                    return [ROA.empty, updateContextErrors(context)(error)];
                },
                ([i, target]) => {
                    return pipe(
                        context.environStack,
                        ROA.takeLeft(i),
                        makeTryCatchJumpOps(target),
                        updateLocation(node),
                        (ops) => [ops, context]
                    );
                }
            )
        );
    }

    function asContinueTarget([i, env]: readonly [number, StatementEnviron]): O.Option<readonly [number, Operation]> {
        const label = node.getLabel()?.getText();
        if (env.kind === 'loop' && (!label || (env.label === label))) return O.some([i, env.continueTarget]);
        return O.none;
    }
}

function adaptDoStatement(node: tsm.DoStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const breakTarget = { kind: 'noop', debug: 'breakTarget' } as Operation;
        const continueTarget = { kind: 'noop', debug: 'continueTarget' } as Operation;
        const startTarget = { kind: 'noop', debug: 'startTarget' } as Operation;
        const expr = node.getExpression();

        return pipe(
            context,
            pushLoopEnviron(breakTarget, continueTarget, node),
            adaptOp(startTarget),
            updateContext(adaptStatement(node.getStatement())),
            updateOps(ROA.append(continueTarget)),
            updateContext(flow(
                adaptExpression(expr, getBooleanConvertOps(expr.getType())),
                updateOps(updateLocation(expr))
            )),
            updateOps(ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget })),
            updateOps(ROA.append(breakTarget)),
            popEnviron(context)
        );
    }
}

function adaptWhileStatement(node: tsm.WhileStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const breakTarget = { kind: 'noop', debug: 'breakTarget' } as Operation;
        const continueTarget = { kind: 'noop', debug: 'continueTarget' } as Operation;
        const expr = node.getExpression();

        return pipe(
            context,
            pushLoopEnviron(breakTarget, continueTarget, node),
            adaptExpression(expr, getBooleanConvertOps(expr.getType())),
            updateOps(updateLocation(expr)),
            updateOps(ROA.prepend(continueTarget)),
            updateOps(ROA.append<Operation>({ kind: 'jumpifnot', target: breakTarget })),
            updateContext(adaptStatement(node.getStatement())),
            updateOps(ROA.append<Operation>({ kind: 'jump', target: continueTarget })),
            updateOps(ROA.append(breakTarget)),
            popEnviron(context)
        )
    }
}

function adaptTryStatement(node: tsm.TryStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const catchClause = node.getCatchClause();
        const finallyBlock = node.getFinallyBlock();
        const $catch = catchClause
            ? { node: catchClause, target: { kind: 'noop', debug: 'catchTarget' } as Operation }
            : undefined;
        const $finally = finallyBlock
            ? { node: finallyBlock, target: { kind: 'noop', debug: 'finallyTarget' } as Operation }
            : undefined;
        const endTarget = { kind: 'noop', debug: 'endTarget' } as Operation;

        return pipe(
            context,
            pushTryCatchEnviron,
            adaptOp({ kind: 'try', catchTarget: $catch?.target, finallyTarget: $finally?.target }),
            updateContext(adaptBlock(node.getTryBlock())),
            updateOps(ROA.append<Operation>({ kind: 'endtry', target: endTarget })),
            updateContext(adaptCatchClause($catch)),
            popEnviron(context),
            updateContext(adaptFinallyBlock($finally)),
            updateOps(ROA.append(endTarget)),
        )

        function adaptCatchClause($catch?: { node: tsm.CatchClause, target: Operation }): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                if (!$catch) return [ROA.empty, context];
                const { node, target } = $catch;

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

        function adaptFinallyBlock($finally?: { node: tsm.Block, target: Operation }): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                if (!$finally) return [ROA.empty, context];
                const { node, target } = $finally;

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

        const startTarget = { kind: 'noop', debug: 'startTarget' } as Operation;
        const conditionTarget = { kind: 'noop', debug: 'conditionTarget' } as Operation;
        const breakTarget = { kind: 'noop', debug: 'breakTarget' } as Operation;
        const continueTarget = { kind: 'noop', debug: 'continueTarget' } as Operation;

        return pipe(
            context,
            pushLoopEnviron(breakTarget, continueTarget, node),
            adaptInitializer(),
            updateOps(ROA.append<Operation>({ kind: "jump", target: conditionTarget })),
            updateOps(ROA.append(startTarget)),
            updateContext(adaptStatement(node.getStatement())),
            updateOps(ROA.append(continueTarget)),
            updateContext(adaptIncrementor()),
            updateOps(ROA.append(conditionTarget)),
            updateContext(adaptCondition(startTarget)),
            updateOps(ROA.append(breakTarget)),
            popEnviron(context),
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

        const startTarget = { kind: 'noop', debug: 'startTarget' } as Operation;
        const breakTarget = { kind: 'noop', debug: 'breakTarget' } as Operation;
        const continueTarget = { kind: 'noop', debug: 'continueTarget' } as Operation;

        return pipe(
            context,
            pushLoopEnviron(breakTarget, continueTarget, node),
            adaptExpression(node.getExpression()),
            updateOps(updateLocation(node.getExpression())),
            updateOps(ROA.concat(options.initOps(continueTarget))),
            updateOps(ROA.append(startTarget)),
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
            popEnviron(context),
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
                    return pipe(
                        context,
                        adaptStoreOps(decl, kind),
                        updateOps(updateLocation(decl)),
                    )
                }
                return pipe(
                    init,
                    resolveExpression(context.scope),
                    E.chain(ctx => ctx.getStoreOps()),
                    E.map(updateLocation(init)),
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

        const conditionTarget = { kind: 'noop', debug: "conditionTarget" } as Operation;

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

        return adaptError(`adaptForInStatement not implemented for ${exprType.getSymbol()?.getName() ?? exprType.getText()}`, node)(context);
    }
}

function adaptForOfStatement(node: tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const expr = node.getExpression();
        const exprType = expr.getType();

        if (exprType.isArray()) return adaptForEachArray(node)(context);
        if (TS.isIterableType(exprType)) return adaptForEachIterator(node)(context);
        return adaptError(`adaptForOfStatement not implemented for ${exprType.getSymbol()?.getName() ?? exprType.getText()}`, node)(context);
    }
}

function adaptSwitchStatement(node: tsm.SwitchStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        const breakTarget = <Operation>{ kind: 'noop', debug: 'breakTarget' };
        let exprVar: number;
        [exprVar, context] = adaptAnonymousVariable(context);

        type Clause = { clauseTarget: Operation, ops: readonly Operation[], statements: readonly tsm.Statement[] }

        const { left: errors, right: clauses } = pipe(
            node.getClauses(),
            ROA.map(clause => {
                const clauseTarget = <Operation>{ kind: 'noop', debug: 'clauseTarget' };
                if (tsm.Node.isCaseClause(clause)) {
                    // if the clause is a case clause, parse the expression and compare it to the switch expression variable
                    // jump to the clause target if they are equal
                    const expr = clause.getExpression();
                    return pipe(
                        expr,
                        parseExpression(context.scope),
                        E.map(ROA.concat<Operation>([
                            { kind: 'loadlocal', index: exprVar },
                            { kind: 'equal' },
                            { kind: 'jumpif', target: clauseTarget }
                        ])),
                        E.map(updateLocation(expr)),
                        E.map(ops => ({ clauseTarget, ops, statements: clause.getStatements() })),
                    );
                } else {
                    // if the clause is a default clause, just jump to the clause target
                    const $default = clause.getFirstChildByKind(tsm.SyntaxKind.DefaultKeyword);
                    const ops = ROA.of<Operation>({ kind: 'jump', target: clauseTarget, location: $default })
                    return E.of({ clauseTarget, ops, statements: clause.getStatements() });
                }
            }),
            ROA.separate
        )

        if (errors.length > 0) return [ROA.empty, updateContextErrors(context)(errors)];

        return pipe(
            context,
            pushSwitchEnviron(breakTarget, node),
            // execute the switch expression and save it to the temporary variable
            adaptExpression(node.getExpression()),
            updateOps(ROA.append<Operation>({ kind: "storelocal", index: exprVar })),
            updateOps(updateLocation(node.getExpression())),
            // append the expression ops for each clause
            updateOps(ROA.concat(pipe(clauses, ROA.chain(({ ops }) => ops)))),
            // append a jump to the break target in case none of the clauses match
            updateOps(ROA.append<Operation>({ kind: 'jump', target: breakTarget})),
            // adapt each clause
            updateContext(adaptClauses(clauses)),
            // append the break target
            updateOps(ROA.append(breakTarget)),
            popEnviron(context),
        )

        function adaptClauses(clauses: readonly Clause[]): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                return pipe(
                    clauses,
                    ROA.map(adaptClause),
                    reduceAdaptations(context),
                )
            }
        }

        function adaptClause(clause: Clause): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                // for each clause, adapt the statements in the clause and prepend the clause target
                return pipe(
                    clause.statements,
                    ROA.map(adaptStatement),
                    reduceAdaptations(context),
                    updateOps(ROA.prepend(clause.clauseTarget)),
                )
            }
        }
    }
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
            case tsm.SyntaxKind.LabeledStatement: return adaptLabeledStatement(node as tsm.LabeledStatement)(context);
            case tsm.SyntaxKind.ReturnStatement: return adaptReturnStatement(node as tsm.ReturnStatement)(context);
            case tsm.SyntaxKind.SwitchStatement: return adaptSwitchStatement(node as tsm.SwitchStatement)(context);
            case tsm.SyntaxKind.ThrowStatement: return adaptThrowStatement(node as tsm.ThrowStatement)(context);
            case tsm.SyntaxKind.TryStatement: return adaptTryStatement(node as tsm.TryStatement)(context);
            case tsm.SyntaxKind.VariableStatement: return adaptVariableDeclarationList((node as tsm.VariableStatement).getDeclarationList())(context);
            case tsm.SyntaxKind.WhileStatement: return adaptWhileStatement(node as tsm.WhileStatement)(context);
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
        environStack: [],
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
        if (node.isAsync()) return E.left(ROA.of(makeParseError(node)("async functions not supported")));
        if (node.isGenerator()) return E.left(ROA.of(makeParseError(node)("generator functions not implemented")));

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
