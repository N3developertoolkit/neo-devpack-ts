import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as TS from '../TS';

import { CompileTimeObject, Scope, createEmptyScope, createScope, updateScope } from "../types/CompileTimeObject";
import { Operation, getBooleanConvertOps, updateLocation } from "../types/Operation";
import { CompileError, E_fromSeparated, ParseError, isVoidLike, makeParseError, updateContextErrors } from "../utils";
import { ContractMethod, ContractVariable } from "../types/CompileOptions";
import { parseExpression } from "./expressionProcessor";
import { parseVariableDeclaration, generateStoreOps, updateDeclarationScope } from "./parseVariableBinding";

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
        // note, since hoisted declarations are not supported inside functions, we don't use hoistDeclarations here
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

        const dropOps = isVoidLike(expr.getType()) ? ROA.empty : ROA.of<Operation>({ kind: 'drop' });
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
        let [ops, $context] = adaptExpression(expr, getBooleanConvertOps(expr.getType()))(context);
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
                    const { scope, variables } = updateDeclarationScope(parsedVariables, context.scope, ctoFactory);
                    return pipe(
                        variables,
                        ROA.map(c => ({ node: c.cto.node, getStoreOps: c.cto.storeOps, index: c.index })),
                        generateStoreOps,
                        E.map(storeOps => ROA.concat(storeOps)(initOps)),
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

                    function ctoFactory(node: tsm.Identifier, symbol: tsm.Symbol, index: number): CompileTimeObject {
                        const slotIndex = index + context.locals.length;
                        const loadOps = ROA.of(<Operation>{ kind: "loadlocal", index: slotIndex });
                        const storeOps = ROA.of(<Operation>{ kind: "storelocal", index: slotIndex });
                        return <CompileTimeObject>{ node, symbol, loadOps, storeOps };
                    }
                }
            )
        )
    }
}

function adaptVariableDeclarationList(node: tsm.VariableDeclarationList): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const kind = node.getDeclarationKind();
        let ops: readonly Operation[] = ROA.empty;
        for (const decl of node.getDeclarations()) {
            let declOps: readonly Operation[];
            [declOps, context] = adaptVariableDeclaration(decl, kind)(context);
            ops = ROA.concat(declOps)(ops);
        }
        return [ops, context];
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
        [exprOps, $context] = adaptExpression(expr, getBooleanConvertOps(expr.getType()))($context);

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
        [exprOps, $context] = adaptExpression(expr, getBooleanConvertOps(expr.getType()))($context);

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

function adaptCatchClause(node: tsm.CatchClause): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        let $context = adaptCatchVariableDeclaration()(context);
        if ($context.locals.length !== context.locals.length + 1) {
            throw new CompileError("expected adaptCatchVariableDeclaration to declare a local variable", node)
        }

        let blockOps;
        [blockOps, $context] = adaptBlock(node.getBlock())($context);

        let operations = pipe(
            blockOps,
            // add an operation to store the error object in the catch variable
            ROA.prepend<Operation>({
                kind: 'storelocal',
                index: context.locals.length,
                location: node.getFirstChildByKind(tsm.SyntaxKind.CatchKeyword)
            }),
        )

        // swap back in the scope from the original context
        return [operations, { ...$context, scope: context.scope }];
    }

    function adaptCatchVariableDeclaration() {
        return (context: AdaptStatementContext): AdaptStatementContext => {
            const decl = node.getVariableDeclaration();
            if (decl) {
                if (decl.getInitializer()) {
                    return updateContextErrors(context)(makeParseError(node)("catch variable must not have an initializer"));
                }
                const name = decl.getNameNode();
                if (tsm.Node.isIdentifier(name)) {
                    return pipe(
                        name,
                        TS.parseSymbol,
                        E.match(
                            updateContextErrors(context),
                            symbol => {
                                const slotIndex = context.locals.length;
                                const loadOps = ROA.of(<Operation>{ kind: "loadlocal", index: slotIndex });
                                const storeOps = ROA.of(<Operation>{ kind: "storelocal", index: slotIndex });
                                const cto = <CompileTimeObject>{ node: name, symbol: symbol, loadOps, storeOps };
                                const scope = updateScope(context.scope)(cto);
                                const locals = ROA.append<LocalVariable>({ name: symbol.getName(), type: name.getType() })(context.locals);
                                return { ...context, scope, locals };
                            }
                        )
                    )
                } else {
                    return updateContextErrors(context)(makeParseError(node)("catch variable must be a simple identifier"));
                }
            }

            // if there is no declaration, create an anonymous variable to hold the error
            const locals = pipe(context.locals, ROA.append<LocalVariable>({ name: `#var${context.locals.length}` }))
            return { ...context, locals };
        }
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

function adaptForStatement(node: tsm.ForStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {

        let [ops, $context] = adaptInitializer()(context);
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
        [incrOps, $context] = adaptIncrementor()($context);
        ops = pipe(
            ops,
            ROA.concat(incrOps),
            ROA.append(conditionTarget)
        )

        let condOps: readonly Operation[] = ROA.empty;
        [condOps, $context] = adaptCondition(startTarget)($context);
        ops = pipe(
            ops,
            ROA.concat(condOps),
            ROA.append(breakTarget),
        );

        $context = popLoopTargets($context, context);
        return [ops, $context];

        function adaptInitializer(): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                const init = node.getInitializer();
                const [ops, $context] = init === undefined
                    ? [[], context]
                    : tsm.Node.isVariableDeclarationList(init)
                        ? adaptVariableDeclarationList(init)(context)
                        : adaptExpression(init)(context);
                return init ? [updateLocation(init)(ops), $context] : [ops, $context];
            }
        }
        function adaptIncrementor(): S.State<AdaptStatementContext, readonly Operation[]> {
            return context => {
                const incr = node.getIncrementor();
                if (incr === undefined) { return [[], context]; }

                let [ops, $context] = adaptExpression(incr)(context);
                ops = updateLocation(incr)(ops);
                return [ops, $context];
            }
        }
        function adaptCondition(startTarget: Operation): S.State<AdaptStatementContext, readonly Operation[]> {
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
    }
}

// function adaptForInStatement(node: tsm.ForInStatement): S.State<AdaptStatementContext, readonly Operation[]> {
//     return context => {
//         const error = makeParseError(node)(`adaptForInStatement not implemented`);
//         const errors = ROA.append(error)(context.errors);
//         return [ROA.empty, { ...context, errors }];
//     }
// }

function adaptForOfStatement(node: tsm.ForOfStatement): S.State<AdaptStatementContext, readonly Operation[]> {
    return context => {
        const error = makeParseError(node)(`adaptForOfStatement not implemented`);
        const errors = ROA.append(error)(context.errors);
        return [ROA.empty, { ...context, errors }];
    }
}

export interface LocalVariable {
    name: string;
    type?: tsm.Type;
}

interface AdaptStatementContext {
    readonly errors: readonly ParseError[];
    readonly locals: readonly LocalVariable[];
    readonly scope: Scope;
    readonly returnTarget: Operation;
    readonly breakTargets: readonly Operation[];
    readonly continueTargets: readonly Operation[];
}

function adaptStatement(node: tsm.Statement): S.State<AdaptStatementContext, readonly Operation[]> {
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
