import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { isJumpTargetOp, Operation, SimpleOperationKind } from "../types/Operation";
import { resolve as $resolve } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { isCallableDef, isObjectDef, makeParseError, parseLoadOps, parseStoreOps } from "../symbolDef";
import { parseSymbol } from "./parseSymbol";
import { isBigIntLike, isBooleanLike, isNumberLike, isStringLike, single } from "../utils";

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
    [tsm.SyntaxKind.AmpersandToken, "and"],
    [tsm.SyntaxKind.AsteriskAsteriskToken, 'power'],
    [tsm.SyntaxKind.AsteriskToken, 'multiply'],
    [tsm.SyntaxKind.BarToken, 'or'],
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

function parseNullishCoalescingExpression(node: tsm.BinaryExpression, scope: Scope) {
    const endTarget = { kind: "noop" } as Operation;
    return pipe(
        node.getLeft(),
        parseExpression(scope),
        E.map(ROA.concat([
            { kind: "duplicate" },
            { kind: "isnull" },
            { kind: "jumpifnot", target: endTarget },
            { kind: "drop" }
        ] as Operation[])),
        E.chain(ops => pipe(
            node.getRight(),
            parseExpression(scope),
            E.map(right => ROA.concat(right)(ops))
        )),
        E.map(ROA.append(endTarget))
    )
}

function parseLogicalAndExpression(node: tsm.BinaryExpression, scope: Scope) {
    // logical "and" coerces left and right expressions to boolean
    const endTarget = { kind: "noop" } as Operation;
    return pipe(
        node.getLeft(),
        parseExpressionAsBoolean(scope),
        E.map(ROA.concat([
            { kind: "jumpif", offset: 3 },
            { kind: "pushbool", value: false },
            { kind: "jump", target: endTarget },
            { kind: "noop" }
        ] as Operation[])),
        E.chain(ops => pipe(
            node.getRight(),
            parseExpressionAsBoolean(scope),
            E.map(right => ROA.concat(right)(ops))
        )),
        E.map(ROA.append(endTarget))
    );
}

function parseLogicalOrExpression(node: tsm.BinaryExpression, scope: Scope) {
    // logical "or" coerces left and right expressions to boolean
    const endTarget = { kind: "noop" } as Operation;
    return pipe(
        node.getLeft(),
        parseExpressionAsBoolean(scope),
        E.map(ROA.concat([
            { kind: "jumpifnot", offset: 3 },
            { kind: "pushbool", value: true },
            { kind: "jump", target: endTarget },
            { kind: "noop" }
        ] as Operation[])),
        E.chain(ops => pipe(
            node.getRight(),
            parseExpressionAsBoolean(scope),
            E.map(right => ROA.concat(right)(ops))
        )),
        E.map(ROA.append(endTarget))
    );
}

function parseAssignmentExpression(node: tsm.BinaryExpression, scope: Scope) {

    const chain = makeExpressionChain(node.getLeft());

    const qqq = pipe(
        chain,
        RNEA.init,
        init => ROA.isNonEmpty(init)
            ? pipe(
                init,
                RNEA.matchLeft((head, tail) => pipe(
                    tail,
                    ROA.reduce(
                        createChainContext(scope)(head),
                        reduceChainContext(scope)
                    )
                ))
            )
            : E.of({ operations: [], def: O.none, endTarget: { kind: 'noop' } } as ChainContext),
        E.bindTo('context'),
        E.bind('last', () => E.of(RNEA.last(chain))),
        E.chain(({ context, last }) => {

            if (tsm.Node.isPropertyAccessExpression(last)) {
                const q = pipe(
                    last, 
                    resolvePropertyAccessExpression(scope, context),
                    E.chain(({property}) => {
                        const zz = pipe(property, parseStoreOps(node))


                        return E.of(12);
                    })
                );


                // return pipe(
                //     node,
                //     resolvePropertyAccessExpression(scope, context),
                //     E.bind('loadOps', ({ property }) => {
                //         return pipe(
                //             property,
                //             parseLoadOps(node),
                //             E.map(ops => {
                //                 return node.hasQuestionDotToken()
                //                     ? ROA.concat(ops)([
                //                         { kind: "duplicate" },
                //                         { kind: "isnull" },
                //                         { kind: "jumpif", target: context.endTarget }
                //                     ] as Operation[]) : ops;
                //             })
                //         );
                //     }),
                //     E.map(({
                //         loadOps,
                //         property
                //     }) => {
                //         return ({
                //             ...context,
                //             operations: ROA.concat(loadOps)(context.operations),
                //             def: O.of(property)
                //         });
                //     })
                // )

            }

            return E.left(makeParseError(last)(`parseAssignmentExpression ${last.getKindName()} not implemented`));

        })
    )



    const q = pipe(
        node.getRight(),
        parseExpression(scope),
        E.map(ROA.append({ kind: "duplicate" } as Operation)),
        E.chain(ops => pipe(
            node.getLeft(),
            parseExpression(scope),
            E.map(right => ROA.concat(right)(ops))

        ))
    )

    return E.left(makeParseError(node)('parseAssignmentExpression'));
}


export const parseBinaryExpression =
    (scope: Scope) =>
        (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {

            const opToken = node.getOperatorToken().getKind();
            if (opToken === tsm.SyntaxKind.AmpersandAmpersandToken) {
                return parseLogicalAndExpression(node, scope);
            }
            if (opToken === tsm.SyntaxKind.BarBarToken) {
                return parseLogicalOrExpression(node, scope);
            }
            if (opToken === tsm.SyntaxKind.QuestionQuestionToken) {
                return parseNullishCoalescingExpression(node, scope);
            }
            if (opToken === tsm.SyntaxKind.EqualsToken) {
                return parseAssignmentExpression(node, scope);
            }

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

export function makeConditionalExpression({ condition, whenTrue, whenFalse }: {
    condition: readonly Operation[];
    whenTrue: readonly Operation[];
    whenFalse: readonly Operation[];
}): readonly Operation[] {

    const falseTarget: Operation = { kind: "noop" };
    const endTarget: Operation = { kind: "noop" };
    return pipe(
        condition,
        ROA.append({ kind: 'jumpifnot', target: falseTarget } as Operation),
        ROA.concat(whenTrue),
        ROA.append({ kind: 'jump', target: endTarget } as Operation),
        ROA.append(falseTarget as Operation),
        ROA.concat(whenFalse),
        ROA.append(endTarget as Operation)
    );
}

export const parseConditionalExpression =
    (scope: Scope) =>
        (node: tsm.ConditionalExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node.getCondition(),
                parseExpressionAsBoolean(scope),
                E.bindTo('condition'),
                E.bind("whenTrue", () => pipe(node.getWhenTrue(), parseExpression(scope))),
                E.bind("whenFalse", () => pipe(node.getWhenFalse(), parseExpression(scope))),
                E.map(makeConditionalExpression)
            )
        }

export const parseIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {

            // Not sure why, but 'undefined' gets parsed as an identifier rather
            // than a keyword or literal. If an identifier's type is null or
            // undefined, skip symbol resolution and simply push null.

            const type = node.getType();
            if (type.isUndefined() || type.isNull()) {
                return E.of(ROA.of({ kind: 'pushnull' }))
            }

            return pipe(
                node,
                parseSymbol,
                E.chain(resolve(node)(scope)),
                E.chain(parseLoadOps(node))
            );
        }

export const parseNullLiteral =
    (_node: tsm.Node): E.Either<ParseError, Operation> =>
        E.right({ kind: "pushnull" });

export const parseNumericLiteral =
    (node: tsm.NumericLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue();
        return Number.isInteger(value)
            ? E.right({ kind: "pushint", value: BigInt(value) })
            : E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
    }

const prefixUnaryOperatorMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
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
        const token = node.getOperatorToken();

        if (token === tsm.SyntaxKind.ExclamationToken) {
            // logical "not" coerces to boolean
            return pipe(
                node.getOperand(),
                parseExpressionAsBoolean(scope),
                E.map(ROA.append({ kind: "not" } as Operation))
            )
        }
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


export function parseExpression(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

        if (tsm.Node.hasExpression(node))
            return parseExpressionChain(scope)(node);
        if (tsm.Node.isArrayLiteralExpression(node))
            return parseArrayLiteral(scope)(node);
        if (tsm.Node.isBigIntLiteral(node))
            return parseLiteral(parseBigIntLiteral)(node);
        if (tsm.Node.isBinaryExpression(node))
            return parseBinaryExpression(scope)(node);
        if (tsm.Node.isConditionalExpression(node))
            return parseConditionalExpression(scope)(node);
        if (tsm.Node.isFalseLiteral(node))
            return parseLiteral(parseBooleanLiteral)(node);
        if (tsm.Node.isIdentifier(node))
            return parseIdentifier(scope)(node);
        if (tsm.Node.isNullLiteral(node))
            return parseLiteral(parseNullLiteral)(node);
        if (tsm.Node.isNumericLiteral(node))
            return parseLiteral(parseNumericLiteral)(node);
        if (tsm.Node.isPrefixUnaryExpression(node))
            return parsePrefixUnaryExpression(scope)(node);
        if (tsm.Node.isStringLiteral(node))
            return parseLiteral(parseStringLiteral)(node);
        if (tsm.Node.isTrueLiteral(node))
            return parseLiteral(parseBooleanLiteral)(node);
        if (tsm.Node.isUndefinedKeyword(node))
            return parseLiteral(parseNullLiteral)(node);
        var kind = (node as tsm.Node).getKindName();
        return E.left(makeParseError(node)(`parseExpression ${kind} failed`));

        function parseLiteral<T>(func: (node: T) => E.Either<ParseError, Operation>) {
            return flow(func, E.map(ROA.of));
        }
    };
}

// TS inherits JS's odd concept of truthy/falsy. As such, this method include code to
// convert an Expression to be boolean typed (as per JS boolean coercion rules)
export function parseExpressionAsBoolean(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

        const parseResult = parseExpression(scope)(node);
        const type = node.getType();

        // boolean experessions don't need to be converted
        if (isBooleanLike(type)) return parseResult;

        // numeric expressions are converted by comparing value to zero
        if (isBigIntLike(type) || isNumberLike(type)) {

            const convertOps: Operation[] = [
                { kind: 'pushint', value: 0n },
                { kind: 'equal' },
            ]
            return pipe(parseResult, E.map(ROA.concat(convertOps)))
        }

        const resolvedType = pipe(
            type,
            TS.getTypeSymbol,
            O.chain($resolve(scope)),
        )

        const matchTypeName = (name: string) => pipe(
            resolvedType,
            O.map(s => s.symbol.getName() === name),
            O.match(() => false, identity)
        )

        // convert bytestring to boolean by comparing to null and comparing length to zero
        if (isStringLike(type) || matchTypeName("ByteStringInstance")) {
            const convertOps: Operation[] = [
                { kind: 'duplicate' },
                { kind: 'isnull' },
                { kind: "jumpifnot", offset: 3 },
                { kind: 'pushbool', value: true },
                { kind: "jump", offset: 4 },
                { kind: 'size' },
                { kind: 'pushint', value: 0n },
                { kind: 'notequal' },
                { kind: 'noop' }
            ]

            return pipe(parseResult, E.map(ROA.concat(convertOps)))
        }

        // convert other objects by comparing to null
        if (O.isSome(resolvedType) && isObjectDef(resolvedType.value)) {
            const convertOps: Operation[] = [
                { kind: 'isnull' },
                { kind: "not" },
            ]
            return pipe(parseResult, E.map(ROA.concat(convertOps)));
        }

        return E.left(makeParseError(node)(`parseExpressionAsBoolean ${type.getText()} failed`));
    };
}

interface ChainContext {
    readonly operations: ReadonlyArray<Operation>;
    readonly def: O.Option<SymbolDef>,
    readonly endTarget: Operation
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
                                endTarget: { kind: 'noop' }
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

            function simpleExpression(): E.Either<ParseError, ChainContext> {
                return pipe(
                    node,
                    parseExpression(scope),
                    E.map(operations => {
                        return {
                            operations,
                            def: O.none,
                            endTarget: { kind: 'noop' }
                        }
                    })
                )
            }
        }

function parseContextDef(node: tsm.Node) {
    return (context: ChainContext) => {
        return pipe(
            context.def,
            E.fromOption(() => {
                return makeParseError(node)(`no context def`);
            })
        );
    };
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
                            ...context,
                            def: O.of(def),
                        }))
                    )),
                    O.match(
                        () => E.of({
                            ...context,
                            def: O.none
                        }),
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
                        return {
                            ...context,
                            def: ctx.def,
                            operations: ctx.operations
                        };
                    })
                )
            }


function resolvePropertyAccessExpression(scope: Scope, context: ChainContext) {
    return (node: tsm.PropertyAccessExpression) => {
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
                                () => {
                                    return makeError(`${type.symbol.getName()} is not an object`);
                                }
                            )
                        );
                    })
                );
            }),
            E.bind('property', ({ symbol, type }) => {
                return pipe(
                    type.props,
                    ROA.filter(p => p.symbol === symbol),
                    single,
                    E.fromOption(() => makeError(`failed to resolve ${symbol.getName()} on ${type.symbol.getName()}`))
                );
            })
        );
    };
}
const parsePropertyAccessExpression =
    (scope: Scope) =>
        (context: ChainContext) =>
            (node: tsm.PropertyAccessExpression): E.Either<ParseError, ChainContext> => {
                const makeError = makeParseError(node);

                return pipe(
                    node,
                    resolvePropertyAccessExpression(scope, context),
                    E.bind('loadOps', ({ property }) => {
                        return pipe(
                            property,
                            parseLoadOps(node),
                            E.map(ops => {
                                return node.hasQuestionDotToken()
                                    ? ROA.concat(ops)([
                                        { kind: "duplicate" },
                                        { kind: "isnull" },
                                        { kind: "jumpif", target: context.endTarget }
                                    ] as Operation[]) : ops;
                            })
                        );
                    }),
                    E.map(({ loadOps, property }) => {
                        return {
                            ...context,
                            operations: ROA.concat(loadOps)(context.operations),
                            def: O.of(property)
                        };
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

export function parseExpressionChain(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, ReadonlyArray<Operation>> => {
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
            E.map(context => {
                const endJumps = pipe(
                    context.operations,
                    ROA.filter(isJumpTargetOp),
                    ROA.filter(op => op.target === context.endTarget),
                )

                // only add the endTarget operation if there is at least 
                // one jump ops targeting it
                return endJumps.length > 0
                    ? ROA.append(context.endTarget)(context.operations)
                    : context.operations;
            })
        );
    };
}
