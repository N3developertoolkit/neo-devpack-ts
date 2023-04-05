import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { isJumpTargetOp, Operation, SimpleOperationKind } from "../types/Operation";
import { resolve as $resolve, resolveName, resolveType } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { isCallableDef, isObjectDef, makeParseError, parseLoadOps } from "../symbolDef";
import { parseSymbol } from "./parseSymbol";
import { isBigIntLike, isBooleanLike, isNumberLike, isStringLike } from "../utils";

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
            const elements = node.getElements();
            return pipe(
                elements,
                ROA.map(parseExpression(scope)),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten),
                E.map(ROA.concat([
                    { kind: "pushint", value: BigInt(elements.length) },
                    { kind: 'packarray' },
                ] as readonly Operation[])),
            )
        }

export const parseBigIntLiteral =
    (node: tsm.BigIntLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue() as bigint;
        return E.right({ kind: "pushint", value });
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

function parseLogicalExpression(node: tsm.BinaryExpression, scope: Scope, isOrOperation: boolean) {
    // logical expressions coerce left and right expressions to boolean
    const endTarget = { kind: "noop" } as Operation;

    const jumpKind = isOrOperation ? "jumpifnot" : "jumpif";
    return pipe(
        node.getLeft(),
        parseExpressionAsBoolean(scope),
        E.map(ROA.concat([
            { kind: jumpKind, offset: 3 },
            { kind: "pushbool", value: isOrOperation },
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

const parseStoreSymbol = (node: tsm.Expression) => (context: ChainContext): E.Either<ParseError, [ChainContext, SymbolDef]> => {
    if (tsm.Node.isIdentifier(node))
        return pipe(
            node,
            parseSymbol,
            E.chain(resolve(node)(context.scope)),
            E.map(def => [context, def])
        );
    if (tsm.Node.isPropertyAccessExpression(node))
        return pipe(
            node,
            resolveProperty(context),
            E.map(def => [context, def])
        );
    return E.left(makeParseError(node)(`parseStore ${node.getKindName()} not impl`));
}

const makeAssignment = (store: tsm.Expression, scope: Scope) => (operations: readonly Operation[]) => {
    return pipe(
        store,
        makeExpressionChain,
        RNEA.matchRight((init, last) => {
            return pipe(init,
                reduceChain(scope),
                E.chain(parseStoreSymbol(last)),
                E.chain(([context, def]) => {
                    if (def.parseStore) {
                        return def.parseStore(context.operations, operations);
                    } else {
                        return E.left(makeParseError(store)('parseStore not implemented'))
                    }
                })
            );
        }),
    )
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

// SlashEqualsToken = 68, DIV
// PercentEqualsToken = 69, MOD
// LessThanLessThanEqualsToken = 70, SHL
// GreaterThanGreaterThanEqualsToken = 71, SHR
// GreaterThanGreaterThanGreaterThanEqualsToken = 72, ???
// AmpersandEqualsToken = 73, AND/BOOLAND
// BarEqualsToken = 74, OR/BOOLOR
// BarBarEqualsToken = 75, BOOLOR
// AmpersandAmpersandEqualsToken = 76, BOOLAND
// QuestionQuestionEqualsToken = 77, CoalesceAssignment
// CaretEqualsToken = 78, XOR

const compoundAssignmentTokenMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
    [tsm.SyntaxKind.AsteriskAsteriskEqualsToken, 'power'],
    [tsm.SyntaxKind.AsteriskEqualsToken, 'multiply'],
    [tsm.SyntaxKind.MinusEqualsToken, 'subtract'],
    [tsm.SyntaxKind.PlusEqualsToken, 'add']
]);

export const parseBinaryExpression =
    (scope: Scope) =>
        (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {

            const opToken = node.getOperatorToken().getKind();
            if (opToken === tsm.SyntaxKind.AmpersandAmpersandToken) {
                return parseLogicalExpression(node, scope, false);
            }
            if (opToken === tsm.SyntaxKind.BarBarToken) {
                return parseLogicalExpression(node, scope, true);
            }
            if (opToken === tsm.SyntaxKind.QuestionQuestionToken) {
                return parseNullishCoalescingExpression(node, scope);
            }
            if (opToken === tsm.SyntaxKind.EqualsToken) {
                return pipe(
                    node.getRight(),
                    parseExpression(scope),
                    E.chain(makeAssignment(node.getLeft(), scope)),
                )
            }

            const compoundAssignmentOpKind = compoundAssignmentTokenMap.get(opToken);
            if (compoundAssignmentOpKind) {
                const left = node.getLeft();
                return pipe(
                    node.getRight(),
                    parseExpression(scope),
                    E.chain(ops => pipe(
                        left,
                        parseExpression(scope),
                        E.map(ROA.concat(ops))
                    )),
                    E.map(ROA.append({ kind: compoundAssignmentOpKind } as Operation)),
                    E.map(ROA.append({ kind: 'duplicate' } as Operation)),
                    E.chain(makeAssignment(left, scope)),
                )
            }

            const binaryOpKind = binaryOpTokenMap.get(opToken);
            if (binaryOpKind) {
                return pipe(
                    node.getRight(),
                    parseExpression(scope),
                    E.chain(right => pipe(
                        node.getLeft(),
                        parseExpression(scope),
                        E.map(ROA.concat(right))
                    )),
                    E.map(ROA.append({ kind: binaryOpKind } as Operation)),
                    E.map(ROA.append({ kind: 'duplicate' } as Operation)),
                )
            }

            return E.left(makeParseError(node)(`parseBinaryOperatorToken ${node.getKindName()} not supported`))
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

export const parsePrefixUnaryOperatorToken =
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
            parsePrefixUnaryOperatorToken,
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

const parseObjectLiteralProperty =
    (scope: Scope) =>
        (prop: tsm.ObjectLiteralElementLike): E.Either<ParseError, readonly Operation[]> => {
            const makeError = makeParseError(prop);

            if (tsm.Node.isPropertyAssignment(prop)) {
                return pipe(
                    prop.getInitializer(),
                    E.fromNullable(makeError("invalid initializer")),
                    E.chain(parseExpression(scope)),
                )
            }

            if (tsm.Node.isShorthandPropertyAssignment(prop)) {
                return pipe(
                    prop.getObjectAssignmentInitializer(),
                    O.fromNullable,
                    O.match(
                        () => pipe(
                            prop,
                            parseSymbol,
                            E.map(s => s.getName()),
                            E.chain(name => pipe(
                                name,
                                resolveName(scope),
                                E.fromOption(() => makeError(`failed to resolve ${name}`))
                            )),
                            E.chain(def => def.loadOps
                                ? E.of(def.loadOps)
                                : E.left(makeError(`${def.symbol.getName()} invalid load ops}`))
                            )
                        ),
                        parseExpression(scope)
                    ),
                )
            }

            return E.left(makeError(`parseObjectLiteralProperty ${prop.getKindName()} not impl`))
        }

export const parseObjectLiteralExpression =
    (scope: Scope) => (node: tsm.ObjectLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node.getProperties(),
            ROA.map(prop => {
                return pipe(
                    prop,
                    parseObjectLiteralProperty(scope),
                    E.bindTo('value'),
                    E.bind('key', () => pipe(prop, parseSymbol, E.map(s => s.getName()))),
                );
            }),
            ROA.sequence(E.Applicative),
            E.map(entities => {
                const values = new Map(entities.map(v => [v.key, v.value]));
                return ROA.of({ kind: 'packmap', values } as Operation)
            })
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

        // I'm thinking this code could be cleaned up by treating *everything* 
        // as an expression chain. As it currently stands, some expression kinds 
        // have to be implemented twice - once for the singleton scenario and once 
        // for being part of a chain. For example `{ hello: "world" }` is a singleton
        // but `{ hello: "world" } as Greeting` is a chain.

        // WIP updating reduceChainContext to handle all these node types.
        // once that's done, can probably eliminate parseExpressionChain and put
        // all that code here in parseExpression

        return pipe(
            node, 
            makeExpressionChain, 
            reduceChain(scope),
            E.map(context => {
                // only add the endTarget operation if there is at least 
                // one jump op targeting it
                const endJumps = pipe(
                    context.operations,
                    ROA.filter(isJumpTargetOp),
                    ROA.filter(op => op.target === context.endTarget),
                )
                return endJumps.length > 0
                    ? ROA.append(context.endTarget)(context.operations)
                    : context.operations;
            })
        );

        // if (tsm.Node.hasExpression(node))
        //     return parseExpressionChain(scope)(node);
        // if (tsm.Node.isArrayLiteralExpression(node))
        //     return parseArrayLiteral(scope)(node);
        // if (tsm.Node.isBigIntLiteral(node))
        //     return parseLiteral(parseBigIntLiteral)(node);
        // if (tsm.Node.isBinaryExpression(node))
        //     return parseBinaryExpression(scope)(node);
        // if (tsm.Node.isConditionalExpression(node))
        //     return parseConditionalExpression(scope)(node);
        // if (tsm.Node.isFalseLiteral(node))
        //     return parseLiteral(parseBooleanLiteral)(node);
        // if (tsm.Node.isIdentifier(node))
        //     return parseIdentifier(scope)(node);
        // if (tsm.Node.isNullLiteral(node))
        //     return parseLiteral(parseNullLiteral)(node);
        // if (tsm.Node.isNumericLiteral(node))
        //     return parseLiteral(parseNumericLiteral)(node);
        // if (tsm.Node.isPrefixUnaryExpression(node))
        //     return parsePrefixUnaryExpression(scope)(node);
        // if (tsm.Node.isObjectLiteralExpression(node))
        //     return parseObjectLiteralExpression(scope)(node);
        // if (tsm.Node.isStringLiteral(node))
        //     return parseLiteral(parseStringLiteral)(node);
        // if (tsm.Node.isTrueLiteral(node))
        //     return parseLiteral(parseBooleanLiteral)(node);
        // if (tsm.Node.isUndefinedKeyword(node))
        //     return parseLiteral(parseNullLiteral)(node);
        // var kind = (node as tsm.Node).getKindName();
        // return E.left(makeParseError(node)(`parseExpression ${kind} failed`));

        // function parseLiteral<T>(func: (node: T) => E.Either<ParseError, Operation>) {
        //     return flow(func, E.map(ROA.of));
        // }
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
            O.chain(resolveType(scope)),
        )

        const matchTypeName = (name: string) => pipe(
            resolvedType,
            O.map(s => s.symbol.getName() === name),
            O.getOrElse(() => false)
        )

        // convert bytestring to boolean by comparing to null and comparing length to zero
        if (isStringLike(type) || matchTypeName("ByteString")) {
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
        if (O.isSome(resolvedType) && "props" in resolvedType.value) {
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
    readonly scope: Scope;
    readonly endTarget: Operation;
    readonly current?: SymbolDef;
    readonly currentType?: tsm.Type;
    readonly operations: ReadonlyArray<Operation>;
}

const reduceIdentifier = (node: tsm.Identifier) =>
    (ctx: ChainContext): E.Either<ParseError, ChainContext> => {
        return pipe(
            node,
            parseSymbol,
            E.chain(resolve(node)(ctx.scope)),
            E.chain(current => {
                if (!current.loadOps)
                    return E.left(makeParseError(node)(`${current.symbol.getName()} invalid load ops`));
                const operations = ROA.concat(current.loadOps)(ctx.operations);
                const context: ChainContext = { ...ctx, operations, current, currentType: undefined }
                return E.of(context);
            })
        );
    }


function resolveProperty(ctx: ChainContext) {
    return (node: tsm.PropertyAccessExpression): E.Either<ParseError, SymbolDef> => {
        return pipe(
            node,
            parseSymbol,
            E.bindTo('symbol'),
            E.bind('typeDef', () => {
                const typeDef = pipe(
                    ctx.currentType,
                    O.fromNullable,
                    O.alt(() => pipe(ctx.current?.type, O.fromNullable)),
                    O.chain(TS.getTypeSymbol),
                    O.chain(resolveType(ctx.scope)),
                    O.toUndefined
                );
                return E.of(typeDef);
            }),
            E.chain(({ symbol, typeDef }) => {
                const props = typeDef && "props" in typeDef
                    ? typeDef.props as readonly SymbolDef[]
                    : ctx.current && isObjectDef(ctx.current)
                        ? ctx.current.props
                        : [];
                return pipe(
                    props,
                    ROA.findFirst(p => p.symbol === symbol),
                    E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} property`)));
            })
        );
    };
}

const reducePropertyAccessExpression =
    (node: tsm.PropertyAccessExpression) =>
        (ctx: ChainContext): E.Either<ParseError, ChainContext> => {

            return pipe(
                node,
                resolveProperty(ctx),
                E.bindTo('property'),
                E.bind('loadOps', ({ property }) => {
                    return pipe(
                        property,
                        parseLoadOps(node),
                        E.map(ops => {
                            return node.hasQuestionDotToken()
                                ? ROA.concat(ops)([
                                    { kind: "duplicate" },
                                    { kind: "isnull" },
                                    { kind: "jumpif", target: ctx.endTarget }
                                ] as Operation[]) : ops;
                        })
                    );
                }),
                E.map(({ loadOps, property }) => {
                    const operations = ROA.concat(loadOps)(ctx.operations);
                    return {
                        ...ctx,
                        operations,
                        current: property,
                        currentType: node.getType(),
                    } as ChainContext;
                })
            )
        }

const reduceCallExpression =
    (node: tsm.CallExpression) =>
        (ctx: ChainContext): E.Either<ParseError, ChainContext> => {
            const makeError = makeParseError(node);

            return pipe(
                ctx.current,
                E.fromNullable(makeError('no current symbol')),
                E.chain(def => pipe(
                    def,
                    E.fromPredicate(
                        isCallableDef,
                        () => makeParseError(node)(`${def.symbol.getName()} not callable`))
                )),
                E.chain(def => def.parseArguments(ctx.scope)(node)),
                E.map(ops => ROA.concat(ctx.operations)(ops)),
                E.map(operations => {
                    return {
                        ...ctx,
                        current: undefined,
                        currentType: node.getType(),
                        operations
                    } as ChainContext
                })
            )
        }

function reduceParseFunction<T extends tsm.Node>(node: T, ctx: ChainContext, func: (node: T) => E.Either<ParseError, readonly Operation[]>) {
    return pipe(
        node,
        func,
        E.map(ops => {
            return {
                ...ctx,
                current: undefined,
                currentType: node.getType(),
                operations: ROA.concat(ops)(ctx.operations)
            };
        })
    );
}

function reduceLiteral<T extends tsm.Node>(node: T, ctx: ChainContext, func: (node: T) => E.Either<ParseError, Operation>) {
    return reduceParseFunction(node, ctx, flow(func, E.map(ROA.of)));
}

const reduceChainContext = (node: tsm.Expression) =>
    (ctx: ChainContext): E.Either<ParseError, ChainContext> => {

        if (tsm.Node.isArrayLiteralExpression(node)) 
            return reduceParseFunction(node, ctx, parseArrayLiteral(ctx.scope));
        if (tsm.Node.isAsExpression(node))
            return E.of({ ...ctx, currentType: node.getType() });
        if (tsm.Node.isBigIntLiteral(node))
            return reduceLiteral(node, ctx, parseBigIntLiteral);
        if (tsm.Node.isBinaryExpression(node))
            return reduceParseFunction(node, ctx, parseBinaryExpression(ctx.scope));
        if (tsm.Node.isCallExpression(node))
            return reduceCallExpression(node)(ctx);
        if (tsm.Node.isConditionalExpression(node))
            return reduceParseFunction(node, ctx, parseConditionalExpression(ctx.scope));
        if (tsm.Node.isFalseLiteral(node))
            return reduceLiteral(node, ctx, parseBooleanLiteral);
        if (tsm.Node.isIdentifier(node))
            return reduceIdentifier(node)(ctx);
        if (tsm.Node.isNonNullExpression(node))
            return E.of(ctx);
        if (tsm.Node.isNullLiteral(node))
            return reduceLiteral(node, ctx, parseNullLiteral);
        if (tsm.Node.isNumericLiteral(node))
            return reduceLiteral(node, ctx, parseNumericLiteral);
        if (tsm.Node.isObjectLiteralExpression(node)) 
            return reduceParseFunction(node, ctx, parseObjectLiteralExpression(ctx.scope));
        if (tsm.Node.isParenthesizedExpression(node))
            return E.of(ctx);
        if (tsm.Node.isPrefixUnaryExpression(node))
            return reduceParseFunction(node, ctx, parsePrefixUnaryExpression(ctx.scope));
        if (tsm.Node.isPropertyAccessExpression(node))
            return reducePropertyAccessExpression(node)(ctx);
        if (tsm.Node.isTrueLiteral(node))
            return reduceLiteral(node, ctx, parseBooleanLiteral);
        if (tsm.Node.isStringLiteral(node))
            return reduceLiteral(node, ctx, parseStringLiteral);
        if (tsm.Node.isUndefinedKeyword(node))
            return reduceLiteral(node, ctx, parseNullLiteral);

        return E.left(makeParseError(node)(`reduceChainContext ${(node as any).getKindName()}`));
    }

// remaining node types from parseExpression to handle in reduceChainContext
    // if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node);
    // if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node);
    // if (tsm.Node.isConditionalExpression(node)) return parseConditionalExpression(scope)(node);
    // if (tsm.Node.isIdentifier(node)) return parseIdentifier(scope)(node);
    // if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node);
    // if (tsm.Node.isObjectLiteralExpression(node)) return parseObjectLiteralExpression(scope)(node);


function reduceChain(scope: Scope) {
    return (chain: readonly tsm.Expression[]) => {
        const initialContext: ChainContext = {
            endTarget: { kind: 'noop' },
            operations: ROA.empty,
            scope,
        };
        return pipe(
            chain,
            ROA.reduce(
                E.of<ParseError, ChainContext>(initialContext),
                (ctx, node) => pipe(ctx, E.chain(reduceChainContext(node)))
            )
        );

    };
}

export function parseExpressionChain(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, ReadonlyArray<Operation>> => {
        return pipe(
            node,
            makeExpressionChain,
            reduceChain(scope),
            E.map(context => {
                // only add the endTarget operation if there is at least 
                // one jump op targeting it
                const endJumps = pipe(
                    context.operations,
                    ROA.filter(isJumpTargetOp),
                    ROA.filter(op => op.target === context.endTarget),
                )
                return endJumps.length > 0
                    ? ROA.append(context.endTarget)(context.operations)
                    : context.operations;
            })
        )
    };
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
