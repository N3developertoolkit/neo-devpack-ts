import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { Operation, SimpleOperationKind } from "../types/Operation";
import { resolve as $resolve } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { isCallableDef, isObjectDef, makeParseError, parseLoadOps } from "../symbolDef";
import { parseSymbol } from "./parseSymbol";
import { single } from "../utils";

export const getArguments = (node: tsm.CallExpression) =>
    ROA.fromArray(node.getArguments() as tsm.Expression[])

export const resolve =
    (node: tsm.Node) =>
        (scope: Scope) =>
            (symbol: tsm.Symbol): E.Either<ParseError, SymbolDef> => {
                return pipe(
                    symbol,
                    $resolve(scope),
                    E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} symbol`))
                )
            }

export const parseArguments = (scope: Scope) => (node: tsm.CallExpression) => {
    return pipe(
        node,
        getArguments,
        ROA.map(parseExpression(scope)),
        ROA.sequence(E.Applicative),
        E.map(ROA.reverse),
        E.map(ROA.flatten),
    );
}

export const parseArrayLiteral =
    (scope: Scope) =>
        (node: tsm.ArrayLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
            // TODO: this doesn't seem right. SHouldn't there be a newarray op here?
            return pipe(
                node.getElements(),
                ROA.map(parseExpression(scope)),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten)
            )
        }

export const parseBigIntLiteral =
    (node: tsm.BigIntLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue() as bigint;
        return E.right({ kind: "pushint", value });
    }

const binaryOpTokenMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
    [tsm.SyntaxKind.AsteriskAsteriskToken, 'power'],
    [tsm.SyntaxKind.AsteriskToken, 'multiply'],
    [tsm.SyntaxKind.EqualsEqualsEqualsToken, 'equal'], // TODO: Should == and === be the same?
    [tsm.SyntaxKind.EqualsEqualsToken, 'equal'],
    [tsm.SyntaxKind.ExclamationEqualsToken, 'notequal'], // TODO: Should != and !== be the same?
    [tsm.SyntaxKind.ExclamationEqualsEqualsToken, 'notequal'],
    [tsm.SyntaxKind.GreaterThanEqualsToken, 'greaterthanorequal'],
    [tsm.SyntaxKind.GreaterThanToken, 'greaterthan'],
    [tsm.SyntaxKind.LessThanEqualsToken, 'lessthanorequal'],
    [tsm.SyntaxKind.LessThanToken, 'lessthan'],
    [tsm.SyntaxKind.PlusToken, 'add']
]);

export const parseBinaryOperatorToken =
    (node: tsm.Node<tsm.ts.BinaryOperatorToken>): E.Either<ParseError, Operation> => {
        return pipe(
            node.getKind(),
            k => binaryOpTokenMap.get(k),
            E.fromNullable(
                makeParseError(node)(`parseBinaryOperatorToken ${node.getKindName()} not supported`)
            ),
            E.map(kind => ({ kind }) as Operation)
        );
    }

export const parseBinaryExpression =
    (scope: Scope) =>
        (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {
            // TODO:  if left and right are strings, PlusToken op should be concat instead of add
            return pipe(
                node.getOperatorToken(),
                parseBinaryOperatorToken,
                // map errors to reference the expression node 
                E.mapLeft(e => makeParseError(node)(e.message)),
                E.chain(op => pipe(
                    node.getRight(),
                    parseExpression(scope),
                    E.map(ROA.append(op))
                )),
                E.chain(ops => pipe(
                    node.getLeft(),
                    parseExpression(scope),
                    E.map(
                        ROA.concat(ops)
                    )
                )),
            )
        }

export const parseBooleanLiteral =
    (node: tsm.FalseLiteral | tsm.TrueLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue();
        return E.right({ kind: "pushbool", value });
    }

export const parseIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                parseSymbol,
                E.chain(resolve(node)(scope)),
                E.chain(parseLoadOps(node))
            );
        }

export const parseNullLiteral =
    (node: tsm.NullLiteral): E.Either<ParseError, Operation> =>
        E.right({ kind: "pushnull" });

export const parseNumericLiteral =
    (node: tsm.NumericLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue();
        return Number.isInteger(value)
            ? E.right({ kind: "pushint", value: BigInt(value) })
            : E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
    }

const prefixUnaryOperatorMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
    [tsm.SyntaxKind.ExclamationToken, 'not'],
    [tsm.SyntaxKind.MinusToken, 'negate']
]);

export const parseUnaryOperatorToken =
    (token: tsm.ts.PrefixUnaryOperator): E.Either<ParseError, Operation> => {
        return pipe(
            token,
            k => prefixUnaryOperatorMap.get(k),
            E.fromNullable(
                makeParseError()(`parseUnaryOperatorToken ${tsm.SyntaxKind[token]} not supported`)
            ),
            E.map(kind => ({ kind }) as Operation)
        );
    }

export const parsePrefixUnaryExpression = (scope: Scope) =>
    (node: tsm.PrefixUnaryExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node.getOperatorToken(),
            parseUnaryOperatorToken,
            // map errors to reference the expression node 
            E.mapLeft(e => makeParseError(node)(e.message)),
            E.chain(op => pipe(
                node.getOperand(),
                parseExpression(scope),
                E.map(
                    ROA.append(op)
                )
            ))
        )
    }

export const parseStringLiteral =
    (node: tsm.StringLiteral): E.Either<ParseError, Operation> => {
        const literal = node.getLiteralValue();
        const value = Buffer.from(literal, 'utf8');
        return E.right({ kind: "pushdata", value });
    }

export const parseExpression =
    (scope: Scope) =>
        (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

            if (tsm.Node.hasExpression(node)) return parseExpressionChain(scope)(node);
            if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node);
            if (tsm.Node.isBigIntLiteral(node)) return parseLiteral(parseBigIntLiteral)(node);
            if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node);
            if (tsm.Node.isFalseLiteral(node)) return parseLiteral(parseBooleanLiteral)(node);
            if (tsm.Node.isIdentifier(node)) return parseIdentifier(scope)(node);
            if (tsm.Node.isNullLiteral(node)) return parseLiteral(parseNullLiteral)(node);
            if (tsm.Node.isNumericLiteral(node)) return parseLiteral(parseNumericLiteral)(node);
            if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node);
            if (tsm.Node.isStringLiteral(node)) return parseLiteral(parseStringLiteral)(node);
            if (tsm.Node.isTrueLiteral(node)) return parseLiteral(parseBooleanLiteral)(node);
            return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} failed`))

            function parseLiteral<T>(func: (node: T) => E.Either<ParseError, Operation>) {
                return flow(func, E.map(ROA.of));
            }
        }

interface ChainContext {
    readonly operations: ReadonlyArray<Operation>;
    readonly def: O.Option<SymbolDef>,
}


const resolveType =
    (node: tsm.Node) =>
        (scope: Scope) =>
            (type: tsm.Type): E.Either<ParseError, O.Option<SymbolDef>> => {
                const symbol = type.getSymbol();
                return symbol
                    ? pipe(
                        symbol,
                        resolve(node)(scope),
                        E.map(def => O.of(def))
                    )
                    : E.of(O.none);
            }

export const parseIdentifierChain =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, ChainContext> => {
            return pipe(
                node,
                parseSymbol,
                E.chain(resolve(node)(scope)),
                E.chain(def => {
                    return pipe(
                        def.loadOps,
                        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} invalid load ops`)),
                        E.map(operations => {
                            return ({
                                def: O.of(def),
                                operations,
                            });
                        })
                    )
                })
            );
        }

const createChainContext =
    (scope: Scope) =>
        (node: tsm.Expression): E.Either<ParseError, ChainContext> => {
            if (tsm.Node.isIdentifier(node)) return parseIdentifierChain(scope)(node);
            if (tsm.Node.isBinaryExpression(node)) return simpleExpression();
            return E.left(makeParseError(node)(`createParseChainContext ${node.getKindName()} failed`))

            function simpleExpression() {
                return pipe(
                    node,
                    parseExpression(scope),
                    E.map(operations => {
                        return {
                            operations,
                            def: O.none
                        } as ChainContext
                    })
                )
            }
        }

const parseContextDef = (node: tsm.Node) => (context: ChainContext) => {
    return pipe(
        context.def,
        E.fromOption(() => {
            return makeParseError(node)(`no context def`);
        })
    )
}

const parseAsExpression =
    (scope: Scope) =>
        (context: ChainContext) =>
            (node: tsm.AsExpression): E.Either<ParseError, ChainContext> => {

                return pipe(
                    node,
                    TS.getType,
                    TS.getTypeSymbol,
                    O.map(flow(
                        resolve(node)(scope),
                        E.map(def => ({
                            operations: context.operations,
                            def: O.of(def),
                        } as ChainContext))
                    )),
                    O.match(
                        () => E.of({
                            operations: context.operations,
                            def: O.none
                        } as ChainContext),
                        identity
                    )
                );
            }

const parseCallExpression =
    (scope: Scope) =>
        (context: ChainContext) =>
            (node: tsm.CallExpression): E.Either<ParseError, ChainContext> => {

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
            (node: tsm.PropertyAccessExpression): E.Either<ParseError, ChainContext> => {
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
        (context: E.Either<ParseError, ChainContext>, node: tsm.Expression) => {

            return pipe(
                context,
                E.chain(context => {
                    if (tsm.Node.isAsExpression(node)) return parseAsExpression(scope)(context)(node);
                    if (tsm.Node.isCallExpression(node)) return parseCallExpression(scope)(context)(node);
                    if (tsm.Node.isNonNullExpression(node)) return E.of(context);
                    if (tsm.Node.isParenthesizedExpression(node)) return E.of(context);
                    if (tsm.Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(scope)(context)(node);
                    return E.left(makeParseError(node)(`reduceParseChainContext ${node.getKindName()} failed`));
                })
            )
        }

export function parseExpressionChain(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, ReadonlyArray<Operation>> => {
        const chain = pipe(node, makeExpressionChain);

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

        function makeExpressionChain(node: tsm.Expression): RNEA.ReadonlyNonEmptyArray<tsm.Expression> {
            return makeChain(RNEA.of<tsm.Expression>(node));

            function makeChain(
                chain: RNEA.ReadonlyNonEmptyArray<tsm.Expression>
            ): RNEA.ReadonlyNonEmptyArray<tsm.Expression> {
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
    };
}
