import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as TS from "../TS";
import { getBooleanConvertOps, getIntegerConvertOps, getStringConvertOps, Operation, pushInt, pushString, isJumpTargetOp, makeConditionalExpression } from "../types/Operation";
import { CompileTimeObject, GetOpsFunc, resolve, resolveName, resolveType, Scope } from "../types/CompileTimeObject";
import { ParseError, isIntegerLike, isStringLike, isVoidLike, makeParseError } from "../utils";
import { StoreOpVariable, generateStoreOps } from "./parseVariableBinding";

interface ExpressionHeadContext {
    readonly scope: Scope,
    readonly endTarget: Operation;
}

interface ExpressionContext extends ExpressionHeadContext {
    readonly node: tsm.Expression | tsm.ShorthandPropertyAssignment;
    readonly type: tsm.Type;
    readonly cto?: CompileTimeObject;

    readonly getOps: () => E.Either<ParseError, readonly Operation[]>;
    // like CTO, getStoreOps assumes the value to store is on the top of the stack
    readonly getStoreOps: () => E.Either<ParseError, readonly Operation[]>;
}

function reduceBigIntLiteral(context: ExpressionHeadContext, node: tsm.BigIntLiteral): E.Either<ParseError, ExpressionContext> {
    const value = node.getLiteralValue() as bigint;
    const getOps = () => E.of(ROA.of<Operation>(pushInt(value)))
    const getStoreOps = () => E.left(makeParseError(node)(`cannot store to bigint literal`));
    return E.of({ ...context, node, type: node.getType(), getOps, getStoreOps });
}

function reduceBooleanLiteral(context: ExpressionHeadContext, node: tsm.BooleanLiteral): E.Either<ParseError, ExpressionContext> {
    const value = node.getLiteralValue();
    const getOps = () => E.of(ROA.of(<Operation>{ kind: "pushbool", value }))
    const getStoreOps = () => E.left(makeParseError(node)(`cannot store to boolean literal`));
    return E.of({ ...context, node, type: node.getType(), getOps, getStoreOps });
}

function reduceNullLiteral(context: ExpressionHeadContext, node: tsm.NullLiteral): E.Either<ParseError, ExpressionContext> {
    const getOps = () => E.of(ROA.of(<Operation>{ kind: "pushnull" }))
    const getStoreOps = () => E.left(makeParseError(node)(`cannot store to null literal`));
    return E.of({ ...context, node, type: node.getType(), getOps, getStoreOps });
}

function reduceNumericLiteral(context: ExpressionHeadContext, node: tsm.NumericLiteral): E.Either<ParseError, ExpressionContext> {
    const value = node.getLiteralValue();

    if (Number.isInteger(value)) {
        const getOps = () => E.of(ROA.of<Operation>(pushInt(value)))
        const getStoreOps = () => E.left(makeParseError(node)(`cannot store to numeric literal`));
        return E.of({ ...context, node, type: node.getType(), getOps, getStoreOps });
    } else {
        return E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
    }
}

function reduceStringLiteral(context: ExpressionHeadContext, node: tsm.StringLiteral): E.Either<ParseError, ExpressionContext> {
    const value = node.getLiteralValue();
    const getOps = () => E.of(ROA.of<Operation>(pushString(value)))
    const getStoreOps = () => E.left(makeParseError(node)(`cannot store to string literal`));
    return E.of({ ...context, node, type: node.getType(), getOps, getStoreOps });
}

function reduceArrayLiteral(context: ExpressionHeadContext, node: tsm.ArrayLiteralExpression): E.Either<ParseError, ExpressionContext> {
    const elements = node.getElements();

    const getOps = pipe(
        elements,
        ROA.map(resolveExpression(context.scope)),
        ROA.sequence(E.Applicative),
        E.chain(elements => pipe(
            elements,
            ROA.map(ctx => ctx.getOps()),
            ROA.sequence(E.Applicative),
            E.map(ROA.flatten),
            E.map(ROA.append<Operation>(pushInt(elements.length))),
            E.map(ROA.append<Operation>({ kind: 'packarray' }))
        ))
    )

    const getStoreOps = pipe(
        elements,
        ROA.mapWithIndex((index, element) => ({element, index})),
        ROA.filter(({element}) => !tsm.Node.isOmittedExpression(element)),
        ROA.map(({element, index}) => {
            return pipe(
                element,
                resolveExpression(context.scope),
                E.map(ctx => ({ctx, index}))
            ) 
        }),
        ROA.map(E.chain(({ctx, index}) => {
            return pipe(
                ctx.getStoreOps(),
                E.map(storeOps => <StoreOpVariable>{
                    index: ROA.of(index),
                    node: ctx.node,
                    storeOps
                }),
            )
        })),
        ROA.sequence(E.Applicative),
        E.chain(generateStoreOps)
    )

    return E.of(<ExpressionContext>{...context, node, type: node.getType(), getOps: () => getOps, getStoreOps: () => getStoreOps})
}

export function reduceObjectLiteral(context: ExpressionHeadContext, node: tsm.ObjectLiteralExpression): E.Either<ParseError, ExpressionContext> {
    const props = node.getProperties();

    const kvps = pipe(
        props,
        ROA.map(prop => pipe(
            E.Do,
            E.bind('key', () => TS.parseSymbol(prop)),
            E.bind('value', () => reduceObjectLiteralProperty(context, prop))
        )),
    );

    const getOps = pipe(
        kvps,
        ROA.map(E.chain(({ key, value }) => {
            return pipe(
                value.getOps(),
                E.map(ROA.append<Operation>(pushString(key.getName()))),
            )
        })),
        ROA.sequence(E.Applicative),
        E.map(ROA.flatten),
        E.map(ROA.append<Operation>(pushInt(props.length))),
        E.map(ROA.append<Operation>({ kind: 'packmap' }))
    )

    const getStoreOps = pipe(
        kvps,
        ROA.map(E.chain(({key, value}) => {
            return pipe(
                value.getStoreOps(),
                E.map(storeOps => <StoreOpVariable>{
                    index: ROA.of(key.getName()),
                    node: value.node,
                    storeOps
                }),
            )
        })),
        ROA.sequence(E.Applicative),
        E.chain(generateStoreOps)
    )

    return E.of(<ExpressionContext>{...context, node, type: node.getType(), getOps: () => getOps, getStoreOps: () => getStoreOps})

    function reduceObjectLiteralProperty(context: ExpressionHeadContext, node: tsm.ObjectLiteralElementLike): E.Either<ParseError, ExpressionContext> {
        const makeError = makeParseError(node);

        if (tsm.Node.isPropertyAssignment(node)) {
            return pipe(
                node.getInitializer(),
                E.fromNullable(makeError('invalid initializer')),
                E.chain(resolveExpression(context.scope))
            )
        }

        if (tsm.Node.isShorthandPropertyAssignment(node)) {
            return pipe(
                node,
                E.fromPredicate(
                    node => !node.hasObjectAssignmentInitializer(),
                    () => makeError(`shorthand property assignment initializer not supported`)),
                E.chain(TS.parseSymbol),
                // TS compiler doesn't use the same symbol instance for shorthand properties
                // as it does for identifiers. So we have to resolve the property by name.
                E.map(symbol => symbol.getName()),
                E.chain(name => pipe(
                    name,
                    resolveName(context.scope),
                    E.fromOption(() => makeError(`shorthand property assignment ${name} not found`))
                )),
                E.map(cto => {
                    const getOps = () => E.of(cto.loadOps);
                    const getStoreOps = () => pipe(
                        cto.storeOps, 
                        E.fromNullable(makeParseError(cto.node)(`cannot store to shorthand property assignment`)))
                    return <ExpressionContext>{ ...context, node, type: node.getType(), cto, getOps, getStoreOps };
                })
            )
        }

        return E.left(makeError(`reduceObjectLiteralProperty ${node.getKindName()} not supported`));
    }
}

function reduceIdentifier(context: ExpressionHeadContext, node: tsm.Identifier): E.Either<ParseError, ExpressionContext> {

    if (node.getType().isUndefined()) {
        // even though there is a SyntaxKind.UndefinedKeyword, the compiler processes "undefined" as an identifier
        // so check the identifier type instead of the node kind
        const getOps = () => E.of(ROA.of(<Operation>{ kind: "pushnull" }))
        const getStoreOps = () => E.left(makeParseError(node)(`cannot store to undefined literal`));
        return E.of({ ...context, node, type: node.getType(), getOps, getStoreOps });
    }

    return pipe(
        node,
        TS.parseSymbol,
        E.chain(symbol => {
            return pipe(
                symbol,
                resolve(context.scope),
                O.alt(() => {
                    return resolveName(context.scope)(symbol.getName());
                }),
                E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()}`)),
            );
        }),
    E.map(cto => {
            const getOps = () => E.of(cto.loadOps);
            const getStoreOps = () => {
                return cto.storeOps
                    ? E.of(cto.storeOps) 
                    : E.left(makeParseError(node)(`symbol ${cto.symbol?.getName()} has no storeOps`));
            };
            return { ...context, node, type: node.getType(), cto, getOps, getStoreOps };
        })
    )
}



function reduceConditionalExpression(context: ExpressionHeadContext, node: tsm.ConditionalExpression): E.Either<ParseError, ExpressionContext> {
    return pipe(
        E.Do,
        E.bind('condition', () => resolveExpression(context.scope)(node.getCondition())),
        E.bind('whenTrue', () => resolveExpression(context.scope)(node.getWhenTrue())),
        E.bind('whenFalse', () => resolveExpression(context.scope)(node.getWhenFalse())),
        E.map(({ condition, whenTrue, whenFalse }) => {
            const getOps = () => pipe(
                E.Do,
                E.bind('condition', () => condition.getOps()),
                E.bind('whenTrue', () => whenTrue.getOps()),
                E.bind('whenFalse', () => whenFalse.getOps()),
                E.map(makeConditionalExpression)
            )
            const getStoreOps = () => E.left(makeParseError(node)(`store conditional expression not supported`));
            return { ...context, node, type: node.getType(), getOps, getStoreOps };
        })
    )
}

const binaryOperationMap = new Map<tsm.SyntaxKind, Operation>([
    [tsm.SyntaxKind.PlusToken, { kind: "add" }],
    [tsm.SyntaxKind.MinusToken, { kind: "subtract" }],
    [tsm.SyntaxKind.AsteriskToken, { kind: "multiply" }],
    [tsm.SyntaxKind.SlashToken, { kind: "divide" }],
    [tsm.SyntaxKind.PercentToken, { kind: "modulo" }],
    [tsm.SyntaxKind.GreaterThanGreaterThanToken, { kind: "shiftright" }],
    [tsm.SyntaxKind.LessThanLessThanToken, { kind: "shiftleft" }],
    [tsm.SyntaxKind.BarToken, { kind: "or" }],
    [tsm.SyntaxKind.AmpersandToken, { kind: "and" }],
    [tsm.SyntaxKind.CaretToken, { kind: "xor" }],
    [tsm.SyntaxKind.EqualsEqualsToken, { kind: "equal" }],
    [tsm.SyntaxKind.EqualsEqualsEqualsToken, { kind: "equal" }],
    [tsm.SyntaxKind.ExclamationEqualsToken, { kind: "notequal" }],
    [tsm.SyntaxKind.ExclamationEqualsEqualsToken, { kind: "notequal" }],
    [tsm.SyntaxKind.GreaterThanToken, { kind: "greaterthan" }],
    [tsm.SyntaxKind.GreaterThanEqualsToken, { kind: "greaterthanorequal" }],
    [tsm.SyntaxKind.LessThanToken, { kind: "lessthan" }],
    [tsm.SyntaxKind.LessThanEqualsToken, { kind: "lessthanorequal" }],
    [tsm.SyntaxKind.AsteriskAsteriskToken, { kind: "power" }],
]) as ReadonlyMap<tsm.SyntaxKind, Operation>;

function reduceBinaryExpression(context: ExpressionHeadContext, node: tsm.BinaryExpression): E.Either<ParseError, ExpressionContext> {

    return pipe(
        E.Do,
        E.bind('left', () => resolveExpression(context.scope)(node.getLeft())),
        E.bind('right', () => resolveExpression(context.scope)(node.getRight())),
        E.map(({ left, right }) => {
            const getOps = makeGetOps(TS.getBinaryOperator(node), left, right);
            const getStoreOps = () => E.left(makeParseError(node)(`store binary expression not supported`));
            return { ...context, node, type: node.getType(), getOps, getStoreOps };
        })
    )

    function makeAssignment(left: ExpressionContext, right: E.Either<ParseError, readonly Operation[]>): E.Either<ParseError, readonly Operation[]> {
        return pipe(
            right,
            E.bindTo('valueOps'),
            E.bind('storeOps', () => left.getStoreOps()),
            E.map(({ valueOps, storeOps }) => pipe(valueOps, ROA.append<Operation>({ kind: 'duplicate' }), ROA.concat(storeOps)))
        )
    }

    function makeGetOps(operator: tsm.ts.BinaryOperator, left: ExpressionContext, right: ExpressionContext): () => E.Either<ParseError, readonly Operation[]> {
        if (operator === tsm.SyntaxKind.EqualsToken) {
            return () => makeAssignment(left, right.getOps());
        }

        const mappedOperator = TS.compoundAssignmentOperatorMap.get(operator);
        if (mappedOperator) {
            return () => makeAssignment(left, getOperatorOps(mappedOperator, left, right));
        }

        return () => getOperatorOps(operator, left, right);
    }

    function getOperatorOps(operator: tsm.ts.BinaryOperator, left: ExpressionContext, right: ExpressionContext): E.Either<ParseError, readonly Operation[]> {
        const makeError = makeParseError(node);

        // the plus token is normally mapped to `add` operation. However, if either operand is a string,
        // both operands are converted to strings and then concatenated.
        if (operator === tsm.SyntaxKind.PlusToken && (isStringLike(left.type) || isStringLike(right.type))) {
            return pipe(
                E.Do,
                E.bind('left', () => pipe(
                    left.getOps(),
                    E.map(ROA.concat(getStringConvertOps(left.type)))
                )),
                E.bind('right', () => pipe(
                    right.getOps(),
                    E.map(ROA.concat(getStringConvertOps(right.type)))
                )),
                E.map(({ left, right }) => pipe(left, ROA.concat(right), ROA.append<Operation>({ kind: "concat" })))
            )
        }

        // for any of the operators with a direct operation corollary, push the operations for the 
        // left and right hand side expressions, then push the correlatated operation.
        const operatorOperation = binaryOperationMap.get(operator);
        if (operatorOperation) {
            return pipe(
                E.Do,
                E.bind('left', () => left.getOps()),
                E.bind('right', () => right.getOps()),
                E.map(({ left, right }) => pipe(left, ROA.concat(right), ROA.append(operatorOperation)
                ))
            );
        }

        switch (operator) {
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing
            // The nullish coalescing (??) operator is a logical operator that returns its right-hand side operand
            // when its left-hand side operand is null or undefined, and otherwise returns its left-hand side operand.
            case tsm.SyntaxKind.QuestionQuestionToken: {
                const endTarget: Operation = { kind: "noop" };
                return pipe(
                    E.Do,
                    E.bind('left', () => left.getOps()),
                    E.bind('right', () => right.getOps()),
                    E.map(({ left, right }) => pipe(
                        left,
                        ROA.concat<Operation>([
                            { kind: "duplicate" },
                            { kind: "isnull" },
                            { kind: "jumpifnot", target: endTarget },
                            { kind: "drop" },
                        ]),
                        ROA.concat(right),
                        ROA.append<Operation>(endTarget)
                    ))
                );
            }
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Comma_operator
            // The comma (,) operator evaluates each of its operands (from left to right)
            // and returns the value of the last operand.
            case tsm.SyntaxKind.CommaToken: {
                const dropOps = isVoidLike(left.type) || (tsm.Node.isExpression(left.node) && TS.isAssignmentExpression(left.node))
                    ? ROA.empty
                    : ROA.of<Operation>({ kind: "drop" });

                return pipe(
                    E.Do,
                    E.bind('left', () => left.getOps()),
                    E.bind('right', () => right.getOps()),
                    E.map(({ left, right }) => pipe(
                        left,
                        ROA.concat(dropOps),
                        ROA.concat(right)
                    ))
                );
            }
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_OR
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_AND
            case tsm.SyntaxKind.BarBarToken:
            case tsm.SyntaxKind.AmpersandAmpersandToken: {
                const rightTarget: Operation = { kind: "noop" };
                const endTarget: Operation = { kind: "noop" };

                const logicalOps: readonly Operation[] = operator === tsm.SyntaxKind.BarBarToken
                    ? [{ kind: "jumpifnot", target: rightTarget }, { kind: "pushbool", value: true }]
                    : [{ kind: "jumpif", target: rightTarget }, { kind: "pushbool", value: false }];

                return pipe(
                    E.Do,
                    E.bind('left', () => pipe(
                        left.getOps(),
                        E.map(ROA.concat(getBooleanConvertOps(left.type)))
                    )),
                    E.bind('right', () => pipe(
                        right.getOps(),
                        E.map(ROA.concat(getBooleanConvertOps(right.type)))
                    )),
                    E.map(({ left, right }) => pipe(
                        left,
                        ROA.concat(logicalOps),
                        ROA.concat<Operation>([{ kind: "jump", target: endTarget }, rightTarget]),
                        ROA.concat(right),
                        ROA.append<Operation>(endTarget)
                    ))

                );
            }
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/in
            // The in operator returns true if the specified property is in the specified object or its prototype chain.
            case tsm.SyntaxKind.InKeyword: {
                return pipe(
                    E.Do,
                    E.bind('left', () => left.getOps()),
                    E.bind('right', () => right.getOps()),
                    E.map(({ left, right }) => pipe(
                        right,
                        ROA.concat(left),
                        ROA.append<Operation>({ kind: "haskey" })
                    ))
                );
            }
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Unsigned_right_shift
            case tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
                return E.left(makeError(`Unsigned right shift operator not supported`));
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof
            case tsm.SyntaxKind.InstanceOfKeyword:
                return E.left(makeError(`instanceof operator not supported`));
        }

        return E.left(makeError(`Invalid binary operator ${tsm.SyntaxKind[operator]}`));
    }
}

function reducePostfixUnaryExpression(context: ExpressionHeadContext, node: tsm.PostfixUnaryExpression): E.Either<ParseError, ExpressionContext> {
    const kind = node.getOperatorToken() === tsm.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
    const operand = node.getOperand();
    if (!isIntegerLike(operand.getType())) {
        E.left(makeParseError(node)(`arithmetic operations only supported on integer types`));
    }

    return pipe(
        operand,
        resolveExpression(context.scope),
        E.map(context => {
            const getStoreOps = () => E.left(makeParseError(node)(`store unary expression not supported`));
            const getOps = () => {
                return pipe(
                    E.Do,
                    E.bind('valueOps', () => context.getOps()),
                    E.bind('storeOps', () => context.getStoreOps()),
                    E.map(({ valueOps, storeOps }) => pipe(
                        valueOps,
                        ROA.concat<Operation>([{ kind: "duplicate" }, { kind }]),
                        ROA.concat(storeOps)
                    ))
                );
            }
            return { ...context, node, type: node.getType(), getOps, getStoreOps };
        })
    )
}

function reducePrefixUnaryExpression(context: ExpressionHeadContext, node: tsm.PrefixUnaryExpression): E.Either<ParseError, ExpressionContext> {
    const operator = node.getOperatorToken();
    const operand = node.getOperand();
    const operandType = operand.getType();
    switch (operator) {
        case tsm.SyntaxKind.PlusPlusToken:
        case tsm.SyntaxKind.MinusMinusToken: {
            if (!isIntegerLike(operandType)) {
                E.left(makeParseError(node)(`arithmetic operations only supported on integer types`));
            }
            const kind = operator === tsm.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
            return pipe(
                operand,
                resolveExpression(context.scope),
                E.map(context => {
                    const getStoreOps = () => E.left(makeParseError(node)(`store unary expression not supported`));
                    const getOps = () => pipe(
                        E.Do,
                        E.bind('valueOps', () => context.getOps()),
                        E.bind('storeOps', () => context.getStoreOps()),
                        E.map(({ valueOps, storeOps }) => pipe(
                            valueOps,
                            ROA.concat<Operation>([{ kind }, { kind: "duplicate" }]),
                            ROA.concat(storeOps)
                        ))
                    )
                    return { ...context, node, type: node.getType(), getOps, getStoreOps };
                })
            )
        }
        case tsm.SyntaxKind.PlusToken: {
            const additionalOps = pipe(operandType, getIntegerConvertOps);
            return makeContext(operand, additionalOps);
        }
        case tsm.SyntaxKind.MinusToken: {
            const additionalOps = pipe(operandType, getIntegerConvertOps, ROA.append<Operation>({ kind: "negate" }));
            return makeContext(operand, additionalOps);
        }
        case tsm.SyntaxKind.TildeToken: {
            const additionalOps = pipe(operandType, getIntegerConvertOps, ROA.append<Operation>({ kind: "invert" }));
            return makeContext(operand, additionalOps);
        }
        case tsm.SyntaxKind.ExclamationToken: {
            const additionalOps = pipe(operandType, getBooleanConvertOps, ROA.append<Operation>({ kind: "not" }));
            return makeContext(operand, additionalOps);
        }
    }

    function makeContext(operand: tsm.Expression, additionalOps: readonly Operation[]): E.Either<ParseError, ExpressionContext> {
        return pipe(
            operand,
            resolveExpression(context.scope),
            E.map(context => {
                const getStoreOps = () => E.left(makeParseError(node)(`store unary expression not supported`));
                const getOps = () => pipe(
                    context.getOps(),
                    E.map(ROA.concat(additionalOps))
                )
                return { ...context, node, type: node.getType(), getOps, getStoreOps };
            })
        )
    }
}

export function reduceExpressionHead(scope: Scope, node: tsm.Expression): E.Either<ParseError, ExpressionContext> {
    const context: ExpressionHeadContext = { scope, endTarget: { kind: "noop" } }
    switch (node.getKind()) {
        case tsm.SyntaxKind.BigIntLiteral:
            return reduceBigIntLiteral(context, node as tsm.BigIntLiteral);
        case tsm.SyntaxKind.FalseKeyword:
        case tsm.SyntaxKind.TrueKeyword:
            return reduceBooleanLiteral(context, node as tsm.BooleanLiteral);
        case tsm.SyntaxKind.NullKeyword:
            return reduceNullLiteral(context, node as tsm.NullLiteral);
        case tsm.SyntaxKind.NumericLiteral:
            return reduceNumericLiteral(context, node as tsm.NumericLiteral);
        case tsm.SyntaxKind.StringLiteral:
            return reduceStringLiteral(context, node as tsm.StringLiteral);
        case tsm.SyntaxKind.ArrayLiteralExpression:
            return reduceArrayLiteral(context, node as tsm.ArrayLiteralExpression);
        case tsm.SyntaxKind.ObjectLiteralExpression:
            return reduceObjectLiteral(context, node as tsm.ObjectLiteralExpression);
        case tsm.SyntaxKind.Identifier:
            return reduceIdentifier(context, node as tsm.Identifier);
        case tsm.SyntaxKind.ConditionalExpression:
            return reduceConditionalExpression(context, node as tsm.ConditionalExpression);
        case tsm.SyntaxKind.BinaryExpression:
            return reduceBinaryExpression(context, node as tsm.BinaryExpression);
        case tsm.SyntaxKind.PostfixUnaryExpression:
            return reducePostfixUnaryExpression(context, node as tsm.PostfixUnaryExpression);
        case tsm.SyntaxKind.PrefixUnaryExpression:
            return reducePrefixUnaryExpression(context, node as tsm.PrefixUnaryExpression);
        default:
            return E.left(makeParseError(node)(`reduceExpressionHead ${node.getKindName()} not supported`));
    }
}

function reduceCallExpression(context: ExpressionContext, node: tsm.CallExpression): E.Either<ParseError, ExpressionContext> {

    return pipe(
        context.cto?.call ? context.cto.call(node) : undefined,
        O.fromNullable,
        O.alt(() => pipe(
            context.type,
            resolveType(context.scope),
            O.chain(ctt => O.fromNullable(ctt.call))
        )),
        // TODO: Optional Chaining support
        E.fromOption(() => makeParseError(node)(`${context.cto?.symbol?.getName()} not callable`)),
        E.bindTo('invoker'),
        E.bind('args', () => {
            return pipe(
                node,
                TS.getArguments,
                ROA.map(resolveExpression(context.scope)),
                ROA.sequence(E.Applicative)
            );
        }),
        E.chain(({ invoker, args }) => {
            return invoker(() => context.getOps(), args.map(arg => () => arg.getOps()));
        }),
        E.map(cto => {
            const getOps = () => E.of(cto.loadOps);
            const getStoreOps = () => E.left(makeParseError(node)(`cannot store to call expression`));
            return { ...context, node, type: node.getType(), cto, getOps, getStoreOps };
        })
    )
}

function reduceNewExpression(context: ExpressionContext, node: tsm.NewExpression): E.Either<ParseError, ExpressionContext> {
    return pipe(
        context.cto?.callNew ? context.cto.callNew(node) : undefined,
        O.fromNullable,
        O.alt(() => {
            return pipe(
                context.type,
                resolveType(context.scope),
                O.chain(ctt => O.fromNullable(ctt.callNew))
            );
        }),
        E.fromOption(() => makeParseError(node)(`${context.cto?.symbol?.getName()} not constructable`)),
        E.bindTo('invoker'),
        E.bind('args', () => {
            return pipe(
                node,
                TS.getArguments,
                ROA.map(resolveExpression(context.scope)),
                ROA.sequence(E.Applicative)
            );
        }),
        E.chain(({ invoker, args }) => {
            return invoker(() => context.getOps(), args.map(arg => () => arg.getOps()));
        }),
        E.map(cto => {
            const getOps = () => E.of(cto.loadOps);
            const getStoreOps = () => E.left(makeParseError(node)(`cannot store to new expression`));
            return { ...context, node, type: node.getType(), cto, getOps, getStoreOps };
        })
    )
}

function reducePropertyAccessExpression(context: ExpressionContext, node: tsm.PropertyAccessExpression): E.Either<ParseError, ExpressionContext> {
    return pipe(
        node,
        TS.parseSymbol,
        E.chain(symbol => {
            return pipe(
                // first, try to resolve the property on the object
                context.cto?.properties?.get(symbol.getName()),
                O.fromNullable,
                // if the object doesn't have the property, try and resolve the property on the type
                O.alt(() => {
                    return pipe(
                        context.type,
                        resolveType(context.scope),
                        O.chain(ctt => {
                            return pipe(
                                // first, try and resolve the type property by symbol
                                ctt.properties?.get(symbol),
                                O.fromNullable,
                                O.alt(() => {
                                    // Properties of concrete generic types don't appear to have the
                                    // same symbol instances as their target type properties.
                                    // So try to resolve type property by name if resolving by symbol fails.
                                    const name = symbol.getName();
                                    for (const [key, value] of ctt.properties?.entries() ?? []) {
                                        if (key.getName() === name) {
                                            return O.some(value);
                                        }
                                    }
                                    return O.none;
                                })
                            )
                        }),
                    );
                }),
                E.fromOption(() => makeParseError(node)(`failed to resolve "${symbol.getName()}" property`))
            );
        }),
        E.chain(resolver => {
            return resolver(context.getOps);
        }),
        E.map(cto => {
            if (node.hasQuestionDotToken()) {
                const loadOps = pipe(
                    cto.loadOps,
                    ROA.concat(optionalChainOps(context)))
                return { ...cto, loadOps } as CompileTimeObject
            }
            return cto;
        }),
        E.map(cto => {
            const getOps = () => E.of(cto.loadOps);
            const getStoreOps = () => {
                return cto.storeOps
                    ? E.of(cto.storeOps)
                    : E.left(makeParseError(node)(`symbol ${cto.symbol?.getName()} has no storeOps`));
            };
            return { ...context, node, type: node.getType(), cto, getOps, getStoreOps };
        })
    )
}

function optionalChainOps(context: ExpressionContext): readonly Operation[] {
    return [
        { kind: "duplicate" },
        { kind: "isnull" },
        { kind: "jumpif", target: context.endTarget }
    ]
}

function reduceElementAccessExpression(context: ExpressionContext, node: tsm.ElementAccessExpression): E.Either<ParseError, ExpressionContext> {
    const chainOps = node.hasQuestionDotToken() ? optionalChainOps(context) : [];
    return pipe(
        node.getArgumentExpression(),
        E.fromNullable(makeParseError(node)(`element access expression has no argument expression`)),
        E.chain(parseExpression(context.scope)),
        E.chain(argExprOps => {
            return pipe(
                context.getOps(),
                E.map(ROA.concat(argExprOps)),
                E.map(ops => {
                    const getOps = () => pipe(
                        ops,
                        ROA.append<Operation>({ kind: "pickitem" }),
                        ROA.concat(chainOps),
                        E.of
                    );
                    const getStoreOps = () => pipe(
                        ops,
                        ROA.append<Operation>({ kind: "rotate" }),
                        ROA.append<Operation>({ kind: "setitem" }),
                        E.of
                    )
                    return { ...context, node, type: node.getType(), getOps, getStoreOps };
                })
            )
        })
    )
}

function reduceExpressionTail(node: tsm.Expression) {
    return (context: ExpressionContext): E.Either<ParseError, ExpressionContext> => {
        switch (node.getKind()) {
            case tsm.SyntaxKind.AsExpression:
            case tsm.SyntaxKind.NonNullExpression:
            case tsm.SyntaxKind.ParenthesizedExpression:
                return E.of({ ...context, type: node.getType() });
            case tsm.SyntaxKind.CallExpression:
                return reduceCallExpression(context, node as tsm.CallExpression);
            case tsm.SyntaxKind.ElementAccessExpression:
                return reduceElementAccessExpression(context, node as tsm.ElementAccessExpression);
            case tsm.SyntaxKind.NewExpression:
                return reduceNewExpression(context, node as tsm.NewExpression);
            case tsm.SyntaxKind.PropertyAccessExpression:
                return reducePropertyAccessExpression(context, node as tsm.PropertyAccessExpression);
            default:
                return E.left(makeParseError(node)(`reduceExpressionTail ${node.getKindName()} not supported`));
        }
    };
}

export function resolveExpression(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, ExpressionContext> => {
        const chain = makeExpressionChain(node);
        const context = reduceExpressionHead(scope, RNEA.head(chain));
        return pipe(
            chain,
            RNEA.tail,
            ROA.reduce(
                context,
                (ctx, node) => E.chain(reduceExpressionTail(node))(ctx)
            ),
            E.map(context => {
                const getOps = () => {
                    return pipe(
                        context.getOps(),
                        E.map(ops => {
                            const endJumps = pipe(
                                ops,
                                ROA.filter(isJumpTargetOp),
                                ROA.filter(op => op.target === context.endTarget),
                            )
                            return endJumps.length > 0
                                ? ROA.append(context.endTarget)(ops)
                                : ops;
                        })
                    )
                };
                return { ...context, getOps };
            })
        )
    }

    function makeExpressionChain(node: tsm.Expression): RNEA.ReadonlyNonEmptyArray<tsm.Expression> {
        return makeChain(RNEA.of(node));

        function makeChain(chain: RNEA.ReadonlyNonEmptyArray<tsm.Expression>): RNEA.ReadonlyNonEmptyArray<tsm.Expression> {
            return pipe(
                chain,
                RNEA.head,
                TS.getExpression,
                O.match(
                    () => chain,
                    expr => pipe(chain, ROA.prepend(expr), makeChain)
                )
            )
        }
    }
}

export function parseExpression(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node,
            resolveExpression(scope),
            E.chain(ctx => ctx.getOps())
        );
    }
}














































// export function flattenNestedAssignmentBinding(binding: NestedAssignmentBinding, index: readonly (number | string)[] = []): readonly CompileTimeObjectWithIndex[] {
//     if (isCTO(binding)) return [{ cto: binding, index }];
//     return pipe(
//         binding,
//         ROA.chain(([binding, i]) => flattenNestedAssignmentBinding(binding, pipe(index, ROA.append(i))))
//     )
// }

// type NestedAssignmentBindings = readonly (readonly [NestedAssignmentBinding, number | string])[];
// type NestedAssignmentBinding = CompileTimeObject | NestedAssignmentBindings;

// function isCTO(binding: NestedAssignmentBinding): binding is CompileTimeObject {
//     return !Array.isArray(binding);
// }

// export function readAssignmentExpression(scope: Scope) {
//     return (node: tsm.Expression): E.Either<ParseError, NestedAssignmentBinding> => {

//         if (tsm.Node.isIdentifier(node)) return readIdentifierAssignment(node, scope);
//         if (tsm.Node.isArrayLiteralExpression(node)) return readArrayLiteralAssignment(node, scope);
//         if (tsm.Node.isObjectLiteralExpression(node)) return readObjectLiteralAssignment(node, scope);

//         return E.left(makeParseError(node)(`readAssignmentExpression ${node.getKindName()} not implemented`));
//     }
// }

// function readIdentifierAssignment(node: tsm.Identifier, scope: Scope): E.Either<ParseError, NestedAssignmentBinding> {
//     return pipe(node, resolveIdentifier(scope))
// }

// function readArrayLiteralAssignment(node: tsm.ArrayLiteralExpression, scope: Scope): E.Either<ParseError, NestedAssignmentBinding> {
//     return pipe(
//         node.getElements(),
//         ROA.mapWithIndex((index, element) => [element, index] as const),
//         ROA.filter(([element]) => !tsm.Node.isOmittedExpression(element)),
//         ROA.map(([element, index]) => {
//             return pipe(
//                 element,
//                 readAssignmentExpression(scope),
//                 E.map(binding => [binding, index] as const)
//             );
//         }),
//         ROA.sequence(E.Applicative),
//     )
// }
// function readObjectLiteralAssignment(node: tsm.ObjectLiteralExpression, scope: Scope): E.Either<ParseError, NestedAssignmentBinding> {
//     return pipe(
//         node.getProperties(),
//         ROA.map(readObjectLiteralAssignmentProperty(scope)),
//         ROA.sequence(E.Applicative),
//     )
// }

// function readObjectLiteralAssignmentProperty(scope: Scope) {
//     return (node: tsm.ObjectLiteralElementLike): E.Either<ParseError, readonly [NestedAssignmentBinding, string]> => {
//         if (tsm.Node.isShorthandPropertyAssignment(node)) {
//             // for shorthand property assignments, the index is the name
//             return pipe(
//                 E.Do,
//                 E.bind('name', () => pipe(node, TS.parseSymbol, E.map(symbol => symbol.getName()))),
//                 E.bind('binding', () => readIdentifierAssignment(node.getNameNode(), scope)),
//                 E.map(({ name, binding }) => [binding, name] as const)
//             );
//         }
//         if (tsm.Node.isPropertyAssignment(node)) {
//             return pipe(
//                 E.Do,
//                 E.bind('name', () => pipe(node, TS.parseSymbol, E.map(symbol => symbol.getName()))),
//                 E.bind('binding', () => {
//                     return pipe(
//                         node.getInitializer(),
//                         E.fromNullable(makeParseError(node)(`expected initializer for property assignment`)),
//                         E.chain(readAssignmentExpression(scope)),
//                     )
//                 }),
//                 E.map(({ name, binding }) => [binding, name] as const)
//             )
//         }
//         return E.left(makeParseError(node)(`readObjectLiteralProperty ${node.getKindName()} not supported`));
//     }
// }