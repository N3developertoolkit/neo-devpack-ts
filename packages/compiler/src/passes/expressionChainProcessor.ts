import { Symbol, Expression, Identifier, Node, PropertyAccessExpression, CallExpression } from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { Operation } from "../types/Operation";
import { resolve, Scope } from "../scope";
import { ParseError, SymbolDef } from "../symbolDef";
import { parseExpression as $parseExpression } from "./expressionProcessor";
import { makeParseError } from "./processSourceFile";

// interface ChainContext {
//     readonly operations: ReadonlyArray<Operation>;
//     parseGetProp: (prop: Symbol) => E.Either<ParseError, GetPropResult>;
//     parseCall: (node: CallExpression, scope: Scope) => E.Either<ParseError, CallResult>
// }

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

// export const parseIdentifier =
//     (scope: Scope) =>
//         (node: Identifier): E.Either<ParseError, ChainContext> => {
//             return pipe(
//                 node,
//                 parseSymbol(),
//                 E.chain(symbol => pipe(
//                     symbol,
//                     resolve(scope),
//                     E.fromOption(() => makeParseError(node)(`unresolved symbol ${symbol.getName()}`))
//                 )),
//                 E.map(makeChainContext(node)(O.none))
//             );
//         }

// const createChainContext =
//     (scope: Scope) =>
//         (node: Expression): E.Either<ParseError, ChainContext> => {
//             if (Node.isIdentifier(node)) return parseIdentifier(scope)(node);
//             return E.left(makeParseError(node)(`createParseChainContext ${node.getKindName()} failed`))
//         }

// const parseCallExpression =
//     (scope: Scope) =>
//         (context: E.Either<ParseError, ChainContext>, node: CallExpression): E.Either<ParseError, ChainContext> => {
            
//             return pipe(
//                 context,
//                 E.bindTo('context'),
//                 E.bind('call', ({context}) => context.parseCall(node, scope)),
//                 E.map(result => {
//                     const operations = pipe(
//                         result.call.args,
//                         ROA.concat(result.context.operations),
//                         ROA.concat(result.call.call)
//                     )

//                     // TODO:
//                     const parseGetProp = () => E.left(makeParseError(node)(`parseGetProp not implemented`));
//                     const parseCall = () => E.left(makeParseError(node)(`parseCall not implemented`));

//                     return { operations, parseGetProp, parseCall } as ChainContext;
//                 })
//             )
//         }

// const parsePropertyAccessExpression =
//     (scope: Scope) =>
//         (context: E.Either<ParseError, ChainContext>, node: PropertyAccessExpression): E.Either<ParseError, ChainContext> => {

//             return pipe(
//                 context,
//                 E.chain(context => pipe(
//                     node,
//                     parseSymbol(),
//                     E.chain(context.parseGetProp),
//                     E.map(result => makeChainContext(node)(O.of(result.access))(result.value))
//                 ))
//             );
//         }

// const reduceChainContext =
//     (scope: Scope) =>
//         (context: E.Either<ParseError, ChainContext>, node: Expression) => {
//             if (Node.isAsExpression(node)) return parseExpression(node.getExpression());
//             if (Node.isCallExpression(node)) return parseCallExpression(scope)(context, node);
//             if (Node.isNonNullExpression(node)) return parseExpression(node.getExpression());
//             // if (Node.isParenthesizedExpression(node)) return parseExpression(node.getExpression());
//             if (Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(scope)(context, node);
//             return E.left(makeParseError(node)(`reduceParseChainContext ${node.getKindName()} failed`));

//             function parseExpression(expression: Expression): E.Either<ParseError, ChainContext> {
//                 return pipe(
//                     expression,
//                     $parseExpression(scope),
//                     E.bindTo('operations'),
//                     E.bind('context', () => context),
//                     E.map(t => ({
//                         ...t.context,
//                         operations: ROA.concat(t.operations)(t.context.operations),
//                     } as ChainContext))
//                 );
//             }
//         }

export const parseExpressionChain =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, ReadonlyArray<Operation>> => {
            const q = pipe(
                node,
                makeExpressionChain,
                // RNEA.matchLeft((head, tail) => pipe(
                //     tail,
                //     ROA.reduce(
                //         createChainContext(scope)(head),
                //         reduceChainContext(scope)
                //     )
                // )),
                // E.map(context => context.operations)
            );

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
