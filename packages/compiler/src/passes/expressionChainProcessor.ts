import { Symbol, Expression, Identifier, Node, PropertyAccessExpression, CallExpression, Type } from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { Operation } from "../types/Operation";
import { resolve as $resolve, Scope } from "../scope";
import { isObjectDef, makeParseError, ParseError, parseLoadOps, SymbolDef } from "../symbolDef";
import { parseExpression as $parseExpression } from "./expressionProcessor";
import {  parseSymbol } from "./processSourceFile";

interface ChainContext {
    readonly operations: ReadonlyArray<Operation>;
    readonly type: Type
}

// const makeChainContext =
//     (node: Expression) => // for error reporting
//         (operations: O.Option<ReadonlyArray<Operation>>) =>
//             (def: SymbolDef): ChainContext => {

//                 const ops = pipe(
//                     operations,
//                     O.match(() => ROA.empty, identity),
//                     ROA.concat(def.loadOperations ?? []),
//                 )

//                 const parseGetProp = isObjectDef(def)
//                     ? (symbol: Symbol) => pipe(
//                         symbol,
//                         def.parseGetProp,
//                         E.fromOption(
//                             () => makeParseError(node)(`${symbol.getName()} property not found`)
//                         )
//                     )
//                     : () => E.left(makeParseError(node)(`${def.symbol.getName()} not an object`))

//                 const parseCall = isCallableDef(def)
//                     ? def.parseCall
//                     : () => E.left(makeParseError(node)(`${def.symbol.getName()} not callable object`));

//                 return { operations: ops, parseGetProp, parseCall }
//             }

// const resolve =
// (scope: Scope) =>
// (): E.Either<ParseError, SymbolDef> => {
// var q = pipe(symbol, $resolve(scope));
// }
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
            (context: ChainContext): E.Either<ParseError, SymbolDef> => resolveType(node)(scope)(context.type);



export const parseIdentifier =
    (scope: Scope) =>
        (node: Identifier): E.Either<ParseError, ChainContext> => {
            return pipe(
                node,
                parseSymbol,
                E.chain(symbol => pipe(
                    symbol,
                    $resolve(scope),
                    E.fromOption(() => makeParseError(node)(`unresolved symbol ${symbol.getName()}`))
                )),
                E.chain(def => {
                    return pipe(
                        def.loadOps,
                        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} invalid load ops`)),
                        E.map(operations => ({
                            type: def.type,
                            operations
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
        (context: E.Either<ParseError, ChainContext>) =>
            (node: CallExpression): E.Either<ParseError, ChainContext> => {

                return context;

                return pipe(
                    context,
                    E.chain(context => E.left(makeParseError(node)(`parseCallExpression not impl`)))
                )

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
                return E.left(makeParseError(node)(`parseCallExpression not impl`));

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
        (context: E.Either<ParseError, ChainContext>) =>
            (node: PropertyAccessExpression): E.Either<ParseError, ChainContext> => {
                return pipe(
                    E.Do,
                    E.bind('symbol', () => parseSymbol(node)),
                    E.bind('type', () => pipe(
                        context, 
                        E.chain(resolveChainContext(node)(scope))
                    )),
                    E.bind('property', ({ symbol, type }) => resolveProperty(node)(symbol)(type)),
                    E.bind('operations', () => pipe(
                        context, 
                        E.map(c => c.operations)
                    )),
                    E.bind('loadOps', ({ property }) => parseLoadOps(node)(property)),
                    E.map(({
                        loadOps,
                        operations,
                        property
                    }) => {
                        const context: ChainContext = {
                            operations: ROA.concat(loadOps)(operations),
                            type: property.type
                        };
                        return context;
                    })
                );
            }

const reduceChainContext =
    (scope: Scope) =>
        (context: E.Either<ParseError, ChainContext>, node: Expression) => {
            // if (Node.isAsExpression(node)) return parseExpression(node.getExpression());
            if (Node.isCallExpression(node)) return parseCallExpression(scope)(context)(node);
            // if (Node.isNonNullExpression(node)) return parseExpression(node.getExpression());
            // if (Node.isParenthesizedExpression(node)) return parseExpression(node.getExpression());
            if (Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(scope)(context)(node);
            return E.left(makeParseError(node)(`reduceParseChainContext ${node.getKindName()} failed`));

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
