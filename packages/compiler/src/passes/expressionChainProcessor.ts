import { Symbol, Expression, Identifier, Node, PropertyAccessExpression, CallExpression, Type, Signature, VoidExpression } from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { Operation } from "../types/Operation";
import { resolve as $resolve, Scope } from "../scope";
import { isCallableDef, isObjectDef, makeParseError, ParseError, parseLoadOps, SymbolDef } from "../symbolDef";
import { parseArguments, parseExpression as $parseExpression } from "./expressionProcessor";
import { parseSymbol } from "./processSourceFile";
import { isVoidLike, single } from "../utils";

interface ChainContext {
    readonly operations: ReadonlyArray<Operation>;
    readonly def: O.Option<SymbolDef>,
}

const resolve =
    (node: Node) =>
        (scope: Scope) =>
            (symbol: Symbol): E.Either<ParseError, SymbolDef> => {
                return pipe(
                    symbol,
                    $resolve(scope),
                    E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} symbol`))
                )
            }

const resolveType =
    (node: Node) =>
        (scope: Scope) =>
            (type: Type): E.Either<ParseError, O.Option<SymbolDef>> => {
                return isVoidLike(type)
                    ? E.of(O.none)
                    : pipe(
                        type,
                        TS.getTypeSymbol,
                        E.fromOption(() => makeParseError(node)(`failed to resolve ${type.getText()} type`)),
                        E.chain(resolve(node)(scope)),
                        E.map(def => O.of(def))
                    )
            }

export const parseIdentifier =
    (scope: Scope) =>
        (node: Identifier): E.Either<ParseError, ChainContext> => {
            return pipe(
                node,
                parseSymbol,
                E.chain(resolve(node)(scope)),
                E.chain(def => {
                    return pipe(
                        def.loadOps,
                        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} invalid load ops`)),
                        E.map(operations => ({
                            def: O.of(def),
                            operations,
                        }))
                    )
                })
            );
        }

const createChainContext =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, ChainContext> => {
            if (Node.isIdentifier(node)) return parseIdentifier(scope)(node);
            return E.left(makeParseError(node)(`createParseChainContext ${node.getKindName()} failed`))
        }

const parseContextDef = (node: Node) => (context: ChainContext) => {
    return pipe(
        context.def,
        E.fromOption(() => {
            return makeParseError(node)(`void context def`);
        })
    )
}

const parseCallExpression =
    (scope: Scope) =>
        (context: ChainContext) =>
            (node: CallExpression): E.Either<ParseError, ChainContext> => {

                return pipe(
                    context,
                    parseContextDef(node),
                    E.chain(def => pipe(
                        def,
                        E.fromPredicate(
                            isCallableDef,
                            () => makeParseError(node)(`${def.symbol.getName()} not callable`))
                    )),
                    E.chain(def => {
                        return def.parseArguments(scope)(node);
                    }),
                    E.map(ops => {
                        return ROA.concat(context.operations)(ops);
                    }),
                    E.bindTo('operations'),
                    E.bind('def', () => {
                        return resolveType(node)(scope)(node.getType());
                    }),
                    E.map(ctx => {
                        return ctx as ChainContext;
                    })
                )
            }

const parsePropertyAccessExpression =
    (scope: Scope) =>
        (context: ChainContext) =>
            (node: PropertyAccessExpression): E.Either<ParseError, ChainContext> => {
                const makeError = makeParseError(node);
                return pipe(
                    node,
                    parseSymbol,
                    E.bindTo('symbol'),
                    E.bind('type', ({ symbol }) => {
                        return pipe(
                            context,
                            parseContextDef(node),
                            E.chain(def => {
                                return pipe(
                                    def.type,
                                    resolveType(node)(scope),
                                    E.chain(E.fromOption(() => makeError(`${symbol.getName()} resolved to void`)))
                                );
                            }),
                            E.chain(type => {
                                return pipe(type,
                                    E.fromPredicate(
                                        isObjectDef,
                                        () => makeError(`${type.symbol.getName()} is not an object`)
                                    )
                                );
                            })
                        )
                    }),
                    E.bind('property', ({ symbol, type }) => {
                        return pipe(
                            type.props,
                            ROA.filter(p => p.symbol === symbol),
                            single,
                            E.fromOption(() => makeError(`failed to resolve ${symbol.getName()} on ${type.symbol.getName()}`))
                        );
                    }),
                    E.bind('loadOps', ({ property }) => {
                        return parseLoadOps(node)(property);
                    }),
                    E.map(({
                        loadOps,
                        property
                    }) => {
                        return ({
                            operations: ROA.concat(loadOps)(context.operations),
                            def: O.of(property)
                        } as ChainContext);
                    })
                )
            }

const reduceChainContext =
    (scope: Scope) =>
        (context: E.Either<ParseError, ChainContext>, node: Expression) => {

            return pipe(
                context,
                E.chain(context => {
                    // if (Node.isAsExpression(node)) return parseExpression(node.getExpression());
                    if (Node.isCallExpression(node)) return parseCallExpression(scope)(context)(node);
                    if (Node.isNonNullExpression(node)) return parseExpression(node.getExpression());
                    // if (Node.isParenthesizedExpression(node)) return parseExpression(node.getExpression());
                    if (Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(scope)(context)(node);
                    return E.left(makeParseError(node)(`reduceParseChainContext ${node.getKindName()} failed`));
                })
            )

            function parseExpression(expression: Expression): E.Either<ParseError, ChainContext> {
                return pipe(
                    expression,
                    $parseExpression(scope),
                    E.bindTo('operations'),
                    E.bind('context', () => context),
                    E.map(t => ({
                        ...t.context,
                        operations: ROA.concat(t.operations)(t.context.operations),
                    } as ChainContext))
                );
            }
        }

export const parseExpressionChain =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, ReadonlyArray<Operation>> => {
            return pipe(
                node,
                makeExpressionChain,
                RNEA.matchLeft((head, tail) => pipe(
                    tail,
                    ROA.reduce(
                        createChainContext(scope)(head),
                        reduceChainContext(scope)
                    )
                )),
                E.map(context => context.operations)
            );

            function makeExpressionChain(node: Expression): RNEA.ReadonlyNonEmptyArray<Expression> {
                return makeChain(RNEA.of<Expression>(node));

                function makeChain(
                    chain: RNEA.ReadonlyNonEmptyArray<Expression>
                ): RNEA.ReadonlyNonEmptyArray<Expression> {
                    return pipe(
                        chain,
                        RNEA.head,
                        TS.getExpression,
                        O.match(
                            () => chain,
                            expr => makeChain(ROA.prepend(expr)(chain))
                        )
                    );
                }
            }
        }
