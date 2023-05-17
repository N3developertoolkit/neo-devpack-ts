import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import * as S from "fp-ts/State";
import { getBooleanConvertOps, getStringConvertOps, isJumpTargetOp, Operation, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, Scope, ScopedNodeFunc, resolve, resolveType } from "../types/CompileTimeObject";
import { CompileError, ParseError, isStringLike, isVoidLike, makeParseError } from "../utils";
import { ReadonlyNonEmptyArray } from "fp-ts/ReadonlyNonEmptyArray";
import { sc } from "@cityofzion/neon-core";

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

function parseBigIntLitera(node: tsm.BigIntLiteral): E.Either<ParseError, readonly Operation[]> {
    const value = node.getLiteralValue() as bigint;
    return pipe(value, pushInt, ROA.of, E.of);
}

function parseBooleanLiteral(node: tsm.BooleanLiteral): E.Either<ParseError, readonly Operation[]> {
    const value = node.getLiteralValue();
    return pipe(<Operation>{ kind: "pushbool", value }, ROA.of, E.of);
}

function parseNullLiteral(node: tsm.NullLiteral): E.Either<ParseError, readonly Operation[]> {
    return pipe(<Operation>{ kind: "pushnull" }, ROA.of, E.of);
}

function parseNumericLiteral(node: tsm.NumericLiteral): E.Either<ParseError, readonly Operation[]> {
    const value = node.getLiteralValue();
    return Number.isInteger(value)
        ? pipe(value, pushInt, ROA.of, E.of)
        : E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
}

function parseStringLiteral(node: tsm.StringLiteral): E.Either<ParseError, readonly Operation[]> {
    const value = node.getLiteralValue();
    return pipe(value, pushString, ROA.of, E.of);
}

function parseConditionalExpression(scope: Scope) {
    return (node: tsm.ConditionalExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            E.Do,
            E.bind('condition', () => pipe(node.getCondition(), parseExpression(scope))),
            E.bind('whenTrue', () => pipe(node.getWhenTrue(), parseExpression(scope))),
            E.bind('whenFalse', () => pipe(node.getWhenFalse(), parseExpression(scope))),
            E.map(makeConditionalExpression)
        );
    };
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

function parseStore(scope: Scope, node: tsm.Expression) {
    return (ops: readonly Operation[]): E.Either<ParseError, readonly Operation[]> => {
        return E.left(makeParseError(node)(`assignment not implemented`));
    }
}

function parseBinaryOperation(scope: Scope, operator: tsm.ts.BinaryOperator, left: tsm.Expression, right: tsm.Expression): E.Either<string | ParseError, readonly Operation[]> {

    // the plus token is normally mapped to `add` operation. However, if either operand is a string,
    // both operands are converted to strings and then concatenated.
    if (operator === tsm.SyntaxKind.PlusToken && (isStringLike(left.getType()) || isStringLike(right.getType()))) {
        return pipe(
            E.Do,
            E.bind('leftOps', () => parseExpressionAsString(scope)(left)),
            E.bind('rightOps', () => parseExpressionAsString(scope)(right)),
            E.map(({ leftOps, rightOps }) => pipe(
                leftOps,
                ROA.concat(rightOps),
                ROA.append<Operation>({ kind: "concat" })
            ))
        );
    }

    // for any of the operators with a direct operation correlary, push the operations for the 
    // left and right hand side expressions, then push the correlatated operation.
    const operatorOperation = binaryOperationMap.get(operator);
    if (operatorOperation) {
        return pipe(
            E.Do,
            E.bind('leftOps', () => parseExpression(scope)(left)),
            E.bind('rightOps', () => parseExpression(scope)(right)),
            E.map(({ leftOps, rightOps }) => pipe(
                leftOps,
                ROA.concat(rightOps),
                ROA.append(operatorOperation)
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
                E.bind('leftOps', () => parseExpression(scope)(left)),
                E.bind('rightOps', () => parseExpression(scope)(right)),
                E.map(({ leftOps, rightOps }) => pipe(
                    leftOps,
                    ROA.concat<Operation>([
                        { kind: "duplicate" },
                        { kind: "isnull" },
                        { kind: "jumpifnot", target: endTarget },
                        { kind: "drop" },
                    ]),
                    ROA.concat(rightOps),
                    ROA.append<Operation>(endTarget)
                ))
            );
        }
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Comma_operator
        // The comma (,) operator evaluates each of its operands (from left to right)
        // and returns the value of the last operand.
        case tsm.SyntaxKind.CommaToken: {
            const dropOps = isVoidLike(left.getType()) || TS.isAssignmentExpression(left)
                ? ROA.empty
                : ROA.of<Operation>({ kind: "drop" });

            return pipe(
                E.Do,
                E.bind('leftOps', () => parseExpression(scope)(left)),
                E.bind('rightOps', () => parseExpression(scope)(right)),
                E.map(({ leftOps, rightOps }) => pipe(
                    leftOps,
                    ROA.concat(dropOps),
                    ROA.concat(rightOps)
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
                E.bind('leftOps', () => parseExpressionAsBoolean(scope)(left)),
                E.bind('rightOps', () => parseExpressionAsBoolean(scope)(right)),
                E.map(({ leftOps, rightOps }) => pipe(
                    leftOps,
                    ROA.concat(logicalOps),
                    ROA.concat<Operation>([{ kind: "jump", target: endTarget }, rightTarget]),
                    ROA.concat(rightOps),
                    ROA.append<Operation>(endTarget)
                ))
            );
        }
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/in
        // The in operator returns true if the specified property is in the specified object or its prototype chain.
        case tsm.SyntaxKind.InKeyword: {
            return pipe(
                E.Do,
                E.bind('leftOps', () => parseExpression(scope)(left)),
                E.bind('rightOps', () => parseExpression(scope)(right)),
                E.map(({ leftOps, rightOps }) => pipe(
                    rightOps,
                    ROA.concat(leftOps),
                    ROA.append<Operation>({ kind: "haskey" })
                ))
            );
        }
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Unsigned_right_shift
        case tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
            return E.left(`Unsigned right shift operator not supported`);
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof
        case tsm.SyntaxKind.InstanceOfKeyword:
            return E.left(`instanceof operator not supported`);
    }

    return E.left(`Invalid binary operator ${tsm.SyntaxKind[operator]}`);
}

function parseBinaryExpression(scope: Scope) {
    return (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {

        const operator = TS.getBinaryOperator(node);
        const left = node.getLeft();
        const right = node.getRight();
        if (operator === tsm.SyntaxKind.EqualsToken) {
            // load the right hand side and store to the left hand side
            return pipe(
                right,
                parseExpression(scope),
                E.chain(parseStore(scope, left))
            );
        }

        const mappedOperator = TS.compoundAssignmentOperatorMap.get(operator);
        if (mappedOperator) {
            return pipe(
                parseBinaryOperation(scope, mappedOperator, left, right),
                E.mapLeft(err => typeof err === 'string' ? makeParseError(node)(err) : err),
                E.chain(parseStore(scope, left))
            );
        }

        // load left and right hand sides, apply operator
        return pipe(
            parseBinaryOperation(scope, operator, left, right),
            E.mapLeft(err => typeof err === 'string' ? makeParseError(node)(err) : err)
        );
    };
}

export function parsePrefixUnaryExpression(scope: Scope) {
    return (node: tsm.PrefixUnaryExpression): E.Either<ParseError, readonly Operation[]> => {
        const operand = node.getOperand();
        const operator = node.getOperatorToken();

        switch (operator) {
            case tsm.SyntaxKind.PlusPlusToken:
            case tsm.SyntaxKind.MinusMinusToken: {
                const kind = operator === tsm.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
                return pipe(
                    operand,
                    parseExpression(scope),
                    E.map(ROA.append<Operation>({ kind })),
                    E.map(ROA.append<Operation>({ kind: "duplicate" })),
                    E.chain(parseStore(scope, operand))
                )
            }
            case tsm.SyntaxKind.PlusToken:
                return pipe(operand, parseExpression(scope));
            case tsm.SyntaxKind.MinusToken:
                return pipe(operand, parseExpression(scope), E.map(ROA.append<Operation>({ kind: "negate" })));
            case tsm.SyntaxKind.TildeToken:
                return pipe(operand, parseExpression(scope), E.map(ROA.append<Operation>({ kind: "invert" })));
            case tsm.SyntaxKind.ExclamationToken:
                return pipe(operand, parseExpressionAsBoolean(scope), E.map(ROA.append<Operation>({ kind: "not" })));
        }

        return E.left(makeParseError(node)(`Invalid prefix unary operator ${tsm.SyntaxKind[operator]}`));
    };
}

export function parsePostfixUnaryExpression(scope: Scope) {
    return (node: tsm.PostfixUnaryExpression): E.Either<ParseError, readonly Operation[]> => {
        const operand = node.getOperand();
        const kind = node.getOperatorToken() === tsm.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
        return pipe(
            operand,
            parseExpression(scope),
            E.map(ROA.append<Operation>({ kind: "duplicate" })),
            E.map(ROA.append<Operation>({ kind })),
            E.chain(parseStore(scope, operand))
        )
    };
}

export function parseArrayLiteral(scope: Scope) {
    return (node: tsm.ArrayLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
        const elements = node.getElements();
        return pipe(
            elements,
            ROA.map(parseExpression(scope)),
            ROA.sequence(E.Applicative),
            E.map(ROA.flatten),
            E.map(ROA.concat([
                { kind: "pushint", value: BigInt(elements.length) },
                { kind: 'packarray' },
            ] as readonly Operation[]))
        );
    };
}


export function parseObjectLiteralExpression(scope: Scope) {
    return (node: tsm.ObjectLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
        const props = node.getProperties();
        return pipe(
            props,
            ROA.map(prop => {
                return pipe(
                    E.Do,
                    E.bind('key', () => pipe(prop, TS.parseSymbol)),
                    E.bind('value', () => pipe(prop, parseProperty)),
                    E.map(({ key, value }) => ROA.append<Operation>(pushString(key.getName()))(value))
                );
            }),
            ROA.sequence(E.Applicative),
            E.map(ROA.flatten),
            E.map(ROA.concat([
                { kind: "pushint", value: BigInt(props.length) },
                { kind: 'packmap' },
            ] as readonly Operation[]))
        );

        function parseProperty(prop: tsm.ObjectLiteralElementLike): E.Either<ParseError, readonly Operation[]> {
            const makeError = makeParseError(prop);

            if (tsm.Node.isPropertyAssignment(prop)) {
                return pipe(
                    prop.getInitializer(),
                    E.fromNullable(makeError("invalid initializer")),
                    E.chain(parseExpression(scope))
                );
            }

            if (tsm.Node.isShorthandPropertyAssignment(prop)) {
                return pipe(
                    prop.getObjectAssignmentInitializer(),
                    E.fromPredicate(
                        init => !init,
                        () => makeParseError(prop)(`shorthand property assignment initializer not supported`)
                    ),
                    E.chain(() => TS.parseSymbol(prop)),
                    // TODO: resolve symbol similar to parseIdentifier
                    E.chain(() => E.left(makeParseError(prop)(`shorthand property assignment not implemented`)))
                );
            }

            return E.left(makeError(`parseObjectLiteralExpression.parseProperty ${prop.getKindName()} not supported`));
        };
    }
}



// function reduceIdentifier(context: ExpressionChainContext, node: tsm.Identifier): E.Either<ParseError, ExpressionChainContext> {

//     return pipe(
//         node,
//         TS.parseSymbol,
//         E.chain(symbol => pipe(
//             symbol,
//             resolve(context.scope),
//             E.fromOption(() => makeParseError(node)(`Failed to resolve identifier ${symbol.getName()}`))
//         )),
//         E.bindTo('cto'),
//         E.bind('loadOps', ({ cto }) => cto.getLoadOps
//             ? cto.getLoadOps(context.scope)(node)
//             : E.left(makeParseError(node)(`${cto.symbol.getName()} does not support load operations`))),
//         E.map(({ cto, loadOps }) => ({ ...context, cto, ops: ROA.concat(context.ops)(loadOps) }))
//     )
// }

// function resolveProperty(context: ExpressionChainContext, node: tsm.PropertyAccessExpression) {
//     return pipe(
//         node,
//         TS.getSymbol,
//         E.fromOption(() => makeParseError(node)(`Failed to resolve symbol for property access expression`)),
//         E.chain(symbol => pipe(
//             // first, try and resolve the property on the current object directly
//             getProperty(context.cto, symbol),
//             // if the property isn't found on the current object, try and resolve
//             // the property on the current object's type
//             O.alt(() => pipe(
//                 context.cto,
//                 O.fromNullable,
//                 O.map(cto => cto.node.getType()),
//                 O.chain(TS.getTypeSymbol),
//                 O.chain(resolveType(context.scope)),
//                 O.chain(cto => getProperty(cto, symbol))
//             )),
//             E.fromOption(() => makeParseError(node)(`Failed to resolve ${symbol.getName()} property`))
//         ))
//     )

//     function getProperty(cto: CompileTimeObject | undefined, symbol: tsm.Symbol) {
//         return cto?.getProperty ? cto.getProperty(symbol) : O.none;
//     }
// }

// function reducePropertyAccessExpression(context: ExpressionChainContext, node: tsm.PropertyAccessExpression): ExpressionChainContext {

//     const jumpOps: readonly Operation[] = node.hasQuestionDotToken()
//         ? [
//             { kind: "duplicate" },
//             { kind: "isnull" },
//             { kind: "jumpif", target: context.endTarget }
//         ]
//         : [];

//     const q = pipe(
//         resolveProperty(context, node),
//         E.bindTo('cto'),
//         E.bind('loadOps', ({ cto }) => cto.getLoadOps
//             ? cto.getLoadOps(context.scope)(node)
//             : E.left(makeParseError(node)(`${cto.symbol.getName()} does not support load operations`))
//         ),
//         E.match(
//             error => (<ExpressionChainContext>{ ...context, error }),
//             ({ cto, loadOps }) => {
//                 return ({ ...context, cto, ops: ROA.concat(context.ops)(loadOps) });
//             }
//         )

//     )
// }

// function resolvePropertyAccessExpression(scope: Scope) {
//     return (node: tsm.PropertyAccessExpression): O.Option<CompileTimeObject> => {
//         const expr = node.getExpression();
//         return pipe(
//             node,
//             TS.getSymbol,
//             O.chain(symbol => pipe(
//                 expr,
//                 resolveExpression(scope),
//                 O.bindTo('exprcto'),
//                 O.bind('propcto', ({ exprcto }) => pipe(
//                     exprcto,
//                     getProperty(symbol),
//                     O.alt(() => pipe(
//                         expr.getType(),
//                         TS.getTypeSymbol,
//                         O.chain(resolveType(scope)),
//                         O.chain(getProperty(symbol))
//                     ))
//                 ))
//             )),
//             O.map(({ exprcto, propcto }) => combineCTO(propcto, exprcto))
//         );
//     }

//     function getProperty(symbol: tsm.Symbol) {
//         return (cto: CompileTimeObject): O.Option<CompileTimeObject> => {
//             return pipe(
//                 cto.getProperty,
//                 O.fromNullable,
//                 O.chain(getProperty => getProperty(symbol))
//             )
//         }
//     }
// }
// function reduceExpressionChain(context: ExpressionChainContext, node: tsm.Expression): E.Either<ParseError, ExpressionChainContext> {

//     switch (node.getKind()) {
//         // case tsm.SyntaxKind.ArrayLiteralExpression:
//         // case tsm.SyntaxKind.AsExpression:
//         // case tsm.SyntaxKind.BigIntLiteral: return reduceBigIntLitera(context, node as tsm.BigIntLiteral);
//         // case tsm.SyntaxKind.BinaryExpression
//         // case tsm.SyntaxKind.CallExpression
//         // case tsm.SyntaxKind.ConditionalExpression
//         // case tsm.SyntaxKind.ElementAccessExpression
//         // case tsm.SyntaxKind.FalseKeyword: return reduceBooleanLiteral(context, node as tsm.BooleanLiteral);
//         // case tsm.SyntaxKind.Identifier: return reduceIdentifier(context, node as tsm.Identifier);
//         // case tsm.SyntaxKind.NewExpression
//         // case tsm.SyntaxKind.NonNullExpression
//         // case tsm.SyntaxKind.NullKeyword: return reduceNullLiteral(context, node as tsm.NullLiteral);
//         // case tsm.SyntaxKind.NumericLiteral: return reduceNumericLiteral(context, node as tsm.NumericLiteral);
//         // case tsm.SyntaxKind.ObjectLiteralExpression
//         // case tsm.SyntaxKind.ParenthesizedExpression
//         // case tsm.SyntaxKind.PostfixUnaryExpression
//         // case tsm.SyntaxKind.PrefixUnaryExpression
//         // case tsm.SyntaxKind.PropertyAccessExpression: return reducePropertyAccessExpression(context, node as tsm.PropertyAccessExpression);
//         // case tsm.SyntaxKind.StringLiteral: return reduceStringLiteral(context, node as tsm.StringLiteral);
//         // case tsm.SyntaxKind.TrueKeyword: return reduceBooleanLiteral(context, node as tsm.BooleanLiteral);
//     }

//     return E.left(makeParseError(node)(`reduceChainContext ${node.getKindName()} not implemented`));
// }



// function makeExpressionChain(node: tsm.Expression): ReadonlyNonEmptyArray<tsm.Expression> {
//     return makeChain(RNEA.of<tsm.Expression>(node));

//     function makeChain(chain: ReadonlyNonEmptyArray<tsm.Expression>): ReadonlyNonEmptyArray<tsm.Expression> {
//         return pipe(
//             chain,
//             RNEA.head,
//             TS.getExpression,
//             O.match(
//                 () => chain,
//                 expr => makeChain(ROA.prepend(expr)(chain))
//             )
//         );
//     }
// }


// interface ExpressionParserContext {
//     readonly errors: readonly ParseError[];
//     readonly scope: Scope;
//     readonly endTarget: Operation;
// }

// type ExpressionParser = S.State<ExpressionParserContext, readonly Operation[]>;

// function adaptBigIntLiteral(node: tsm.BigIntLiteral): S.State<ExpressionParserContext, readonly Operation[]> {
//     return context => {
//         const value = node.getLiteralValue() as bigint;
//         const ops = pushInt(value);

//         return [[], context];
//     }
// }

export function parseExpression(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

        return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} not implemented`));

        // const chain = makeExpressionChain(node);
        // const context: ExpressionParserContext = {
        //     errors: [],
        //     scope,
        //     endTarget: { kind: 'noop' },
        // }

        // throw new Error();

        // return pipe(
        //     chain,
        //     ROA.reduce(
        //         E.of<ParseError, ExpressionChainContext>(context),
        //         (ctx, node) => { return pipe(ctx, E.chain(ctx => reduceExpressionChain(ctx, node))); }
        //     ),
        //     E.map(ctx => {
        //         const hasEndJumps = pipe(
        //             ctx.ops,
        //             ROA.filter(isJumpTargetOp),
        //             ROA.filter(op => op.target === ctx.endTarget),
        //             ROA.isNonEmpty
        //         );
        //         return hasEndJumps
        //             ? ROA.append(ctx.endTarget)(ctx.ops)
        //             : ctx.ops;

        //     })
        // );
    }
}

export function parseExpressionAsBoolean(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node,
            parseExpression(scope),
            E.map(ROA.concat(getBooleanConvertOps(node.getType())))
        )
    }
}

export function parseExpressionAsString(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node,
            parseExpression(scope),
            E.map(ROA.concat(getStringConvertOps(node.getType())))
        )
    }
}
























// export const parseCallExpression =
//     (scope: Scope) => (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
//         const q = tsm.Node.isExpressioned(node);

//         return pipe(
//             node.getExpression(),
//             resolveExpression(scope),
//             O.chain(cto => O.fromNullable(cto.parseCall)),
//             E.fromOption(() => makeParseError(node)(`parseCall not available for ${node.getExpression().print()}`)),
//             E.chain(parseCall => parseCall(scope)(node))
//         )
//     }

// export const parseNewExpression =
//     (scope: Scope) => (node: tsm.NewExpression): E.Either<ParseError, readonly Operation[]> => {
//         return pipe(
//             node.getExpression(),
//             resolveExpression(scope),
//             O.chain(cto => O.fromNullable(cto.parseConstructor)),
//             E.fromOption(() => makeParseError(node)(`parseConstructor not available for ${node.getExpression().print()}`)),
//             E.chain(parseConstructor => parseConstructor(scope)(node))
//         )
//     }

// export const parsePropertyAccessExpression =
//     (scope: Scope) => (node: tsm.PropertyAccessExpression): E.Either<ParseError, readonly Operation[]> => {
//         return pipe(
//             node,
//             resolvePropertyAccessExpression(scope),
//             E.fromOption(() => makeParseError(node)(`failed to resolve ${node.getName()} property`)),
//             E.chain(cto => pipe(
//                 cto.getLoadOps,
//                 E.fromNullable(makeParseError(node)(`can't load ${node.getName()} property`))
//             )),
//             E.chain(getLoadOps => getLoadOps(scope)(node))
//         );
//     }

// export const parseIdentifier =
//     (scope: Scope) => (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {

//         // undefined resolves as a symbol rather than as a keyword like null does
//         const type = node.getType();
//         if (type.isUndefined()) { return E.of(ROA.of({ kind: 'pushnull' })) }

//         return pipe(
//             node,
//             resolveIdentifier(scope),
//             E.fromOption(() => makeParseError(node)(`failed to resolve ${node.getText()} identifier`)),
//             E.chain(cto => pipe(
//                 cto.getLoadOps,
//                 E.fromNullable(makeParseError(node)(`can't load ${node.getText()} identifier`))
//             )),
//             E.chain(getLoadOps => getLoadOps(scope)(node))
//         );
//     }

// export const parseAsExpression =
//     (scope: Scope) => (node: tsm.AsExpression): E.Either<ParseError, readonly Operation[]> => {
//         return parseExpression(scope)(node.getExpression())
//     }

// function parseBinaryOperatorExpression(scope: Scope, operator: tsm.ts.BinaryOperator, left: tsm.Expression, right: tsm.Expression): E.Either<string | ParseError, readonly Operation[]> {

//     if (operator === tsm.SyntaxKind.PlusToken && isStringLike(left.getType())) {
//         return parseStringConcat(scope, left, right);
//     }

//     const operatorOperation = binaryOperationMap.get(operator);
//     if (operatorOperation) {
//         return parseOperatorOperation(operatorOperation, scope, left, right);
//     }

//     switch (operator) {
//         case tsm.SyntaxKind.QuestionQuestionToken:
//             return parseNullishCoalescing(scope, left, right);
//         case tsm.SyntaxKind.CommaToken:
//             return parseCommaOperator(scope, left, right);
//         case tsm.SyntaxKind.BarBarToken:
//         case tsm.SyntaxKind.AmpersandAmpersandToken:
//             return parseLogicalOperation(operator, scope, left, right);
//         case tsm.SyntaxKind.InKeyword:
//             return parseInOperator(scope, left, right);
//         // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Unsigned_right_shift
//         case tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
//         // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof
//         case tsm.SyntaxKind.InstanceOfKeyword:
//             return E.left(`${tsm.SyntaxKind[operator]} operator not supported`);
//     }

//     return E.left(`Invalid binary operator ${tsm.SyntaxKind[operator]}`);
// }

// export const parseBinaryExpression =
//     (scope: Scope) =>
//         (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {

//             const operator = TS.getBinaryOperator(node);
//             const left = node.getLeft();
//             const right = node.getRight();

//             if (operator === tsm.SyntaxKind.EqualsToken) {
//                 const loadOps = pipe(right, parseExpression(scope))
//                 // todo: left store ops
//                 return E.left(makeParseError(node)(`assignment not yet implemented`));
//             } else {
//                 const mappedOperator = TS.compoundAssignmentOperatorMap.get(operator);
//                 if (mappedOperator) {
//                     const loadOps = parseBinaryOperatorExpression(scope, mappedOperator, left, right);
//                     // todo: left store ops
//                     return E.left(makeParseError(node)(`assignment not yet implemented`));
//                 } else {
//                     return pipe(
//                         parseBinaryOperatorExpression(scope, operator, left, right),
//                         E.mapLeft(msg => typeof msg === "string" ? makeParseError(node)(msg) : msg)
//                     );
//                 }
//             }
//         }


// export const parseParenthesizedExpression =
//     (scope: Scope) =>
//         (node: tsm.ParenthesizedExpression): E.Either<ParseError, readonly Operation[]> => {
//             return parseExpression(scope)(node.getExpression())
//         }

// export const parseNonNullExpression =
//     (scope: Scope) =>
//         (node: tsm.NonNullExpression): E.Either<ParseError, readonly Operation[]> => {
//             return parseExpression(scope)(node.getExpression())
//         }

// export function parseExpression(scope: Scope) {
//     return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

//         if (tsm.Node.hasExpression(node)) {
//             throw new CompileError(`Unexpected expression node ${node.getKindName()}`, node);
//         }
//         switch (node.getKind()) {
//             case tsm.SyntaxKind.AsExpression: return parseAsExpression(scope)(node as tsm.AsExpression);
//             case tsm.SyntaxKind.BigIntLiteral: return parseBigIntLiteral(node as tsm.BigIntLiteral);
//             case tsm.SyntaxKind.BinaryExpression: return parseBinaryExpression(scope)(node as tsm.BinaryExpression);
//             case tsm.SyntaxKind.CallExpression: return parseCallExpression(scope)(node as tsm.CallExpression);
//             case tsm.SyntaxKind.FalseKeyword: return parseBooleanLiteral(node as tsm.FalseLiteral);
//             case tsm.SyntaxKind.Identifier: return parseIdentifier(scope)(node as tsm.Identifier);
//             case tsm.SyntaxKind.NewExpression: return parseNewExpression(scope)(node as tsm.NewExpression);
//             case tsm.SyntaxKind.NonNullExpression: return parseNonNullExpression(scope)(node as tsm.NonNullExpression);
//             case tsm.SyntaxKind.NullKeyword: return parseNullLiteral(node as tsm.NullLiteral);
//             case tsm.SyntaxKind.NumericLiteral: return parseNumericLiteral(node as tsm.NumericLiteral);
//             case tsm.SyntaxKind.ParenthesizedExpression: return parseParenthesizedExpression(scope)(node as tsm.ParenthesizedExpression);
//             case tsm.SyntaxKind.PostfixUnaryExpression: return parsePostfixUnaryExpression(scope)(node as tsm.PostfixUnaryExpression);
//             case tsm.SyntaxKind.PrefixUnaryExpression: return parsePrefixUnaryExpression(scope)(node as tsm.PrefixUnaryExpression);
//             case tsm.SyntaxKind.PropertyAccessExpression: return parsePropertyAccessExpression(scope)(node as tsm.PropertyAccessExpression);
//             case tsm.SyntaxKind.StringLiteral: return parseStringLiteral(node as tsm.StringLiteral);
//             case tsm.SyntaxKind.TrueKeyword: return parseBooleanLiteral(node as tsm.TrueLiteral);

//             default:
//                 return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} not impl`));
//         };
//     }
// }

// export function parseExpressionAsBoolean(scope: Scope) {
//     return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
//         return pipe(
//             node,
//             parseExpression(scope),
//             E.map(ROA.concat(getBooleanConvertOps(node.getType())))
//         )
//     }
// }

// export function parseExpressionAsString(scope: Scope) {
//     return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {


//         return pipe(
//             node,
//             parseExpression(scope),
//             E.map(ROA.concat(getStringConvertOps(node.getType())))
//         )
//     }
// }

// function resolveIdentifier(scope: Scope) {
//     return (node: tsm.Identifier): O.Option<CompileTimeObject> => {
//         return pipe(
//             node,
//             TS.getSymbol,
//             O.chain(resolve(scope))
//         );
//     };
// }

// function combineCTO(cto: CompileTimeObject, parentCTO: CompileTimeObject): CompileTimeObject {

//     const getLoadOps: ScopedNodeFunc<tsm.Expression> = (scope) => (node) => pipe(
//         parentCTO.getLoadOps,
//         E.fromNullable(makeParseError(parentCTO.node)(`no load ops`)),
//         E.chain(getLoadOps => getLoadOps(scope)(node)),
//         E.chain(parentOps => pipe(
//             cto.getLoadOps,
//             E.fromNullable(makeParseError(cto.node)(`no load ops`)),
//             E.chain(getLoadOps => getLoadOps(scope)(node)),
//             E.map(ctoOps => ROA.concat(ctoOps)(parentOps))
//         ))
//     );

//     // TODO: store ops

//     return <CompileTimeObject>{
//         ...cto,
//         getLoadOps
//     }

// }

// function resolvePropertyAccessExpression(scope: Scope) {
//     return (node: tsm.PropertyAccessExpression): O.Option<CompileTimeObject> => {
//         const expr = node.getExpression();
//         return pipe(
//             node,
//             TS.getSymbol,
//             O.chain(symbol => pipe(
//                 expr,
//                 resolveExpression(scope),
//                 O.bindTo('exprcto'),
//                 O.bind('propcto', ({ exprcto }) => pipe(
//                     exprcto,
//                     getProperty(symbol),
//                     O.alt(() => pipe(
//                         expr.getType(),
//                         TS.getTypeSymbol,
//                         O.chain(resolveType(scope)),
//                         O.chain(getProperty(symbol))
//                     ))
//                 ))
//             )),
//             O.map(({ exprcto, propcto }) => combineCTO(propcto, exprcto))
//         );
//     }

//     function getProperty(symbol: tsm.Symbol) {
//         return (cto: CompileTimeObject): O.Option<CompileTimeObject> => {
//             return pipe(
//                 cto.getProperty,
//                 O.fromNullable,
//                 O.chain(getProperty => getProperty(symbol))
//             )
//         }
//     }
// }


// function resolveCallExpression(scope: Scope) {
//     return (node: tsm.CallExpression): O.Option<CompileTimeObject> => {
//         return pipe(
//             node.getExpression(),
//             resolveExpression(scope),
//         )
//     }
// }

// export function resolveExpression(scope: Scope) {
//     return (node: tsm.Expression): O.Option<CompileTimeObject> => {

//         switch (node.getKind()) {
//             case tsm.SyntaxKind.CallExpression: return resolveCallExpression(scope)(node as tsm.CallExpression);
//             case tsm.SyntaxKind.Identifier: return resolveIdentifier(scope)(node as tsm.Identifier);
//             case tsm.SyntaxKind.PropertyAccessExpression: return resolvePropertyAccessExpression(scope)(node as tsm.PropertyAccessExpression);
//             case tsm.SyntaxKind.NonNullExpression: return resolveExpression(scope)((node as tsm.NonNullExpression).getExpression());
//         };

//         throw new CompileError(`resolveExpression ${node.getKindName()} not impl`, node);
//     };
// }

