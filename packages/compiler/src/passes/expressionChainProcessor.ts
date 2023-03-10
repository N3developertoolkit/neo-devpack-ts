import { Symbol, Expression, Identifier, Node, PropertyAccessExpression, CallExpression, Type, Signature } from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { Operation } from "../types/Operation";
import { resolve as $resolve, Scope } from "../scope";
import { isObjectDef, makeParseError, ParseError, parseLoadOps, SymbolDef } from "../symbolDef";
import { parseArguments, parseExpression as $parseExpression } from "./expressionProcessor";
import { parseSymbol } from "./processSourceFile";

interface ChainContext {
    readonly operations: ReadonlyArray<Operation>;
    readonly def: SymbolDef,
    // readonly callSigs: ReadonlyArray<Signature>;
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
            (type: Type): E.Either<ParseError, SymbolDef> => {
                return pipe(
                    type,
                    TS.getTypeSymbol,
                    E.fromOption(() => makeParseError(node)(`failed to resolve ${type.getText()} type`)),
                    E.chain(resolve(node)(scope))
                )
            }

const resolveChainContext =
    (node: Node) =>
        (scope: Scope) =>
            (context: ChainContext): E.Either<ParseError, SymbolDef> => resolveType(node)(scope)(context.def.type);

export const parseIdentifier =
    (scope: Scope) =>
        (node: Identifier): E.Either<ParseError, ChainContext> => {
            return pipe(
                node,
                parseSymbol,
                E.chain(symbol => {
                    return pipe(
                        symbol,
                        $resolve(scope),
                        E.fromOption(() => makeParseError(node)(`unresolved symbol ${symbol.getName()}`))
                    );
                }),
                E.chain(def => {
                    return pipe(
                        def.loadOps,
                        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} invalid load ops`)),
                        E.map(operations => ({
                            def,
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

const parseCallExpression =
    (scope: Scope) =>
        (context: ChainContext) =>
            (node: CallExpression): E.Either<ParseError, ChainContext> => {

                const q = pipe(
                    node,
                    parseArguments(scope),
                    E.map(operations => ROA.concat(context.operations)(operations))
                )
                return E.of(context);
                // prepend the arguments
                const ctx = context;
                return E.left(makeParseError(node)(`parseCallExpression not impl`));

                // return pipe(
                //     context,
                //     E.bindTo('context'),
                //     E.bind('call', ({context}) => context.parseCall(node, scope)),
                //     E.map(result => {
                //         const operations = pipe(
                //             result.call.args,
                //             ROA.concat(result.context.operations),
                //             ROA.concat(result.call.call)
                //         )

                //         // TODO:
                //         const parseGetProp = () => E.left(makeParseError(node)(`parseGetProp not implemented`));
                //         const parseCall = () => E.left(makeParseError(node)(`parseCall not implemented`));

                //         return { operations, parseGetProp, parseCall } as ChainContext;
                //     })
                // )
            }

const resolveProperty =
    (node: Node) =>
        (symbol: Symbol) =>
            (type: SymbolDef) => {
                return pipe(
                    type,
                    O.fromPredicate(isObjectDef),
                    E.fromOption(() => makeParseError(node)(`${type.symbol.getName()} is not an object`)),
                    E.chain(type => {
                        return pipe(
                            type.props,
                            ROA.findFirst(p => p.symbol === symbol),
                            E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} on ${type.symbol.getName()}`))
                        );
                    })
                );
            }

const parsePropertyAccessExpression =
    (scope: Scope) =>
        (context: ChainContext) =>
            (node: PropertyAccessExpression): E.Either<ParseError, ChainContext> => {
                return pipe(
                    E.Do,
                    E.bind('symbol', () => {
                        return parseSymbol(node);
                    }),
                    E.bind('type', () => {
                        return resolveChainContext(node)(scope)(context);
                    }),
                    E.bind('property', ({ symbol, type }) => {
                        return resolveProperty(node)(symbol)(type);
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
                                def: property
                            } as ChainContext);
                        })
                );
            }

/*
    in TS, the call expression carries the arguments and whatever is left
    of call expression carries the info about the call itself
*/


const reduceChainContext =
    (scope: Scope) =>
        (context: E.Either<ParseError, ChainContext>, node: Expression) => {

            return pipe(
                context,
                E.chain(context => {
                    // if (Node.isAsExpression(node)) return parseExpression(node.getExpression());
                    if (Node.isCallExpression(node)) return parseCallExpression(scope)(context)(node);
                    // if (Node.isNonNullExpression(node)) return parseExpression(node.getExpression());
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
            const c = pipe(node, makeExpressionChain);
            const ct = c.map(e => e.getType().getText());
            const ctt = c.map(e => e.getType().getCallSignatures());
            const q = pipe(
                node,
                makeExpressionChain,
                RNEA.matchLeft((head, tail) => pipe(
                    tail,
                    ROA.reduce(
                        createChainContext(scope)(head),
                        reduceChainContext(scope)
                    )
                )),
                // E.map(context => context.operations)
            );


            return E.right([]);
            return E.left(makeParseError(node)('parseExpressionChain not implemented'));

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
