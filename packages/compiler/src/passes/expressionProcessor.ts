import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as TS from "../TS";
import { getBooleanConvertOps, getIntegerConvertOps, getStringConvertOps, Operation, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, resolve, Scope } from "../types/CompileTimeObject";
import { ParseError, isStringLike, isVoidLike, makeParseError } from "../utils";
import { parseSymbol } from "../builtin/types";
import { reduceRight } from "fp-ts/lib/Foldable";

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

interface ExpressionHeadContext {
    readonly scope: Scope,
    readonly endTarget: Operation;
}

interface ExpressionContext extends ExpressionHeadContext {
    readonly node: tsm.Expression;
    readonly type: tsm.Type;

    readonly getOps: () => E.Either<ParseError, readonly Operation[]>;
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
    return pipe(
        elements,
        ROA.map(resolveExpression(context.scope)),
        ROA.sequence(E.Applicative),
        E.map(elements => {
            const getOps = () => pipe(
                elements,
                ROA.map(ctx => ctx.getOps()),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten),
                E.map(ROA.append<Operation>(pushInt(elements.length))),
                E.map(ROA.append<Operation>({ kind: 'packarray' }))
            )
            const getStoreOps = () => E.left(makeParseError(node)(`store array literal not implemented`));
            return { ...context, node, type: node.getType(), getOps, getStoreOps };
        })
    );
}

function reduceObjectLiteral(context: ExpressionHeadContext, node: tsm.ObjectLiteralExpression): E.Either<ParseError, ExpressionContext> {
    const props = node.getProperties();
    return pipe(
        props,
        ROA.map(prop => pipe(
            E.Do,
            E.bind('key', () => TS.parseSymbol(prop)),
            E.bind('value', () => reduceObjectLiteralProperty(context.scope, prop))
        )),
        ROA.sequence(E.Applicative),
        E.map(props => {
            const getOps = () => pipe(
                props,
                ROA.map(({ key, value }) => pipe(
                    value.getOps(),
                    E.map(ROA.append<Operation>(pushString(key.getName())))
                )),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten),
                E.map(ROA.append<Operation>(pushInt(props.length))),
                E.map(ROA.append<Operation>({ kind: 'packmap' }))
            )
            const getStoreOps = () => E.left(makeParseError(node)(`store object literal not supported`));
            return { ...context, node, type: node.getType(), getOps, getStoreOps };
        })

    )

    function reduceObjectLiteralProperty(scope: Scope, node: tsm.ObjectLiteralElementLike): E.Either<ParseError, ExpressionContext> {
        const makeError = makeParseError(node);

        if (tsm.Node.isPropertyAssignment(node)) {
            return pipe(
                node.getInitializer(),
                E.fromNullable(makeError('invalid initializer')),
                E.chain(resolveExpression(scope))
            )
        }

        if (tsm.Node.isShorthandPropertyAssignment(node)) {
            return pipe(
                node.getObjectAssignmentInitializer(),
                E.fromPredicate(
                    init => !init,
                    () => makeError(`shorthand property assignment initializer not supported`)
                ),
                E.chain(() => TS.parseSymbol(node)),
                E.chain(flow(resolveSymbol(scope), E.mapLeft(makeError)))
            )
        }
        return E.left(makeError(`reduceObjectLiteralProperty ${node.getKindName()} not supported`));
    }
}

function reduceIdentifier(context: ExpressionHeadContext, node: tsm.Identifier): E.Either<ParseError, ExpressionContext> {
    return pipe(
        node,
        TS.parseSymbol,
        E.chain(flow(resolveSymbol(context.scope), E.mapLeft(makeParseError(node))))
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

    function makeGetOps(operator: tsm.ts.BinaryOperator, left: ExpressionContext, right: ExpressionContext): () => E.Either<ParseError, readonly Operation[]> {
        if (operator === tsm.SyntaxKind.EqualsToken) {
            return () => pipe(
                E.Do,
                E.bind('left', () => left.getStoreOps()),
                E.bind('right', () => right.getOps()),
                E.map(({ left, right }) => ROA.concat(left)(right))
            )
        }

        const mappedOperator = TS.compoundAssignmentOperatorMap.get(operator);
        if (mappedOperator) {
            return () => pipe(
                E.Do,
                E.bind('left', () => left.getStoreOps()),
                E.bind('right', () => pipe(getOperatorOps(mappedOperator, left, right))),
                E.map(({ left, right }) => ROA.concat(left)(right))
            )
        }

        return () => pipe(getOperatorOps(operator, left, right));
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

        // for any of the operators with a direct operation correlary, push the operations for the 
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
                const dropOps = isVoidLike(left.type) || TS.isAssignmentExpression(left.node)
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
    return pipe(
        node.getOperand(),
        resolveExpression(context.scope),
        E.map(context => {
            const getStoreOps = () => E.left(makeParseError(node)(`store unary expression not supported`));
            const getOps = () => pipe(
                E.Do,
                E.bind("load", () => context.getOps()),
                E.bind("store", () => context.getStoreOps()),
                E.map(({ load, store }) => pipe(
                    load,
                    ROA.append<Operation>({ kind: "duplicate" }),
                    ROA.append<Operation>({ kind }),
                    ROA.concat(store))
                )
            )
            return { ...context, node, type: node.getType(), getOps, getStoreOps };
        })
    )
}

function reducePrefixUnaryExpression(context: ExpressionHeadContext, node: tsm.PrefixUnaryExpression): E.Either<ParseError, ExpressionContext> {
    const operator = node.getOperatorToken();
    const operand = node.getOperand();
    switch (operator) {
        case tsm.SyntaxKind.PlusPlusToken:
        case tsm.SyntaxKind.MinusMinusToken: {
            const kind = operator === tsm.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
            return pipe(
                operand,
                resolveExpression(context.scope),
                E.map(context => {
                    const getStoreOps = () => E.left(makeParseError(node)(`store unary expression not supported`));
                    const getOps = () => pipe(
                        E.Do,
                        E.bind("load", () => context.getOps()),
                        E.bind("store", () => context.getStoreOps()),
                        E.map(({ load, store }) => pipe(
                            load,
                            ROA.append<Operation>({ kind }),
                            ROA.append<Operation>({ kind: "duplicate" }),
                            ROA.concat(store))
                        )
                    )
                    return { ...context, node, type: node.getType(), getOps, getStoreOps };
                })
            )
        }
        case tsm.SyntaxKind.PlusToken:
            return makeContext(operand, getIntegerConvertOps(node.getType()));
        case tsm.SyntaxKind.MinusToken: {
            const additionalOps = ROA.append<Operation>({ kind: "negate" })(getIntegerConvertOps(node.getType()));
            return makeContext(operand, additionalOps);
        }
        case tsm.SyntaxKind.TildeToken:
            return makeContext(operand, [{ kind: "invert" }]);
        case tsm.SyntaxKind.ExclamationToken: {
            const additionalOps = ROA.append<Operation>({ kind: "not" })(getBooleanConvertOps(node.getType()));
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

function reduceExpressionHead(scope: Scope, node: tsm.Expression): E.Either<ParseError, ExpressionContext> {
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

function reduceExpressionTail(node: tsm.Expression) {
    return (context: ExpressionContext): E.Either<ParseError, ExpressionContext> => {
        switch (node.getKind()) {
            case tsm.SyntaxKind.AsExpression:
            case tsm.SyntaxKind.NonNullExpression:
            case tsm.SyntaxKind.ParenthesizedExpression: {
                const type = node.getType();
                return E.of({ ...context, type });
            }
            case tsm.SyntaxKind.CallExpression:
            case tsm.SyntaxKind.ElementAccessExpression:
            case tsm.SyntaxKind.NewExpression:
            case tsm.SyntaxKind.PropertyAccessExpression: {
                return E.left(makeParseError(node)(`reduceExpressionTail ${node.getKindName()} not implemented`));
            }
            default: {
                return E.left(makeParseError(node)(`reduceExpressionTail ${node.getKindName()} not supported`));
            }
        }
    };
}

function resolveSymbol(scope: Scope) {
    return (symbol: tsm.Symbol): E.Either<string, ExpressionContext> => {
        return E.left((`resolveSymbol not implemented (${symbol.getName()})`));
    }
}


function resolveExpression(scope: Scope) {
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
        )
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
