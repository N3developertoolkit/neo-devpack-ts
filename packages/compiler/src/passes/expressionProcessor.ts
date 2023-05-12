import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import { getBooleanConvertOps, getStringConvertOps, Operation, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, Scope, resolve, resolveType } from "../types/CompileTimeObject";
import { ParseError, isStringLike, isVoidLike, makeParseError } from "../utils";

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

export const parseBigIntLiteral =
    (node: tsm.BigIntLiteral): E.Either<ParseError, readonly Operation[]> => {
        const value = node.getLiteralValue() as bigint;
        return pipe(value, pushInt, ROA.of, E.of);
    }

export const parseBooleanLiteral =
    (node: tsm.FalseLiteral | tsm.TrueLiteral): E.Either<ParseError, readonly Operation[]> => {
        const value = node.getLiteralValue();
        return pipe(<Operation>{ kind: "pushbool", value }, ROA.of, E.of);
    }

export const parseNullLiteral =
    (_node: tsm.Node): E.Either<ParseError, readonly Operation[]> =>
        pipe(<Operation>{ kind: "pushnull" }, ROA.of, E.of);


export const parseNumericLiteral =
    (node: tsm.NumericLiteral): E.Either<ParseError, readonly Operation[]> => {
        const value = node.getLiteralValue();
        return Number.isInteger(value)
            ? pipe(value, pushInt, ROA.of, E.of)
            : E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
    }

export const parseStringLiteral =
    (node: tsm.StringLiteral): E.Either<ParseError, readonly Operation[]> => {
        const literal = node.getLiteralValue();
        return pipe(literal, pushString, ROA.of, E.of);
    }

export const parseCallExpression =
    (scope: Scope) => (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node.getExpression(),
            resolveExpression(scope),
            O.chain(cto => O.fromNullable(cto.parseCall)),
            E.fromOption(() => makeParseError(node)(`parseCall not available for ${node.getExpression().print()}`)),
            E.chain(parseCall => parseCall(scope)(node))
        )
    }

export const parseNewExpression =
    (scope: Scope) => (node: tsm.NewExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node.getExpression(),
            resolveExpression(scope),
            O.chain(cto => O.fromNullable(cto.parseConstructor)),
            E.fromOption(() => makeParseError(node)(`parseConstructor not available for ${node.getExpression().print()}`)),
            E.chain(parseConstructor => parseConstructor(scope)(node))
        )
    }

export const parsePropertyAccessExpression =
    (scope: Scope) => (node: tsm.PropertyAccessExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node,
            resolvePropertyAccessExpression(scope),
            E.fromOption(() => makeParseError(node)(`failed to resolve ${node.getName()} property`)),
            E.chain(cto => pipe(
                cto.getLoadOps,
                E.fromNullable(makeParseError(node)(`can't load ${node.getName()} property`))
            )),
            E.chain(getLoadOps => getLoadOps(scope)(node))
        );
    }

export const parseIdentifier =
    (scope: Scope) => (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {

        // undefined resolves as a symbol rather than as a keyword like null does
        const type = node.getType();
        if (type.isUndefined()) { return E.of(ROA.of({ kind: 'pushnull' })) }

        return pipe(
            node,
            resolveIdentifier(scope),
            E.fromOption(() => makeParseError(node)(`failed to resolve ${node.getText()} identifier`)),
            E.chain(cto => pipe(
                cto.getLoadOps,
                E.fromNullable(makeParseError(node)(`can't load ${node.getText()} identifier`))
            )),
            E.chain(getLoadOps => getLoadOps(scope)(node))
        );
    }

export const parseAsExpression =
    (scope: Scope) => (node: tsm.AsExpression): E.Either<ParseError, readonly Operation[]> => {
        return parseExpression(scope)(node.getExpression())
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

function parseBinaryOperatorExpression(scope: Scope, operator: tsm.ts.BinaryOperator, left: tsm.Expression, right: tsm.Expression): E.Either<string | ParseError, readonly Operation[]> {

    if (operator === tsm.SyntaxKind.PlusToken && isStringLike(left.getType())) {
        return parseStringConcat(scope, left, right);
    }

    const operatorOperation = binaryOperationMap.get(operator);
    if (operatorOperation) {
        return parseOperatorOperation(operatorOperation, scope, left, right);
    }

    switch (operator) {
        case tsm.SyntaxKind.QuestionQuestionToken:
            return parseNullishCoalescing(scope, left, right);
        case tsm.SyntaxKind.CommaToken:
            return parseCommaOperator(scope, left, right);
        case tsm.SyntaxKind.BarBarToken:
        case tsm.SyntaxKind.AmpersandAmpersandToken:
            return parseLogicalOperation(operator, scope, left, right);
        case tsm.SyntaxKind.InKeyword:
            return parseInOperator(scope, left, right);
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Unsigned_right_shift
        case tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof
        case tsm.SyntaxKind.InstanceOfKeyword:
            return E.left(`${tsm.SyntaxKind[operator]} operator not supported`);
    }

    return E.left(`Invalid binary operator ${tsm.SyntaxKind[operator]}`);
}
    function parseOperatorOperation(operatorOperation: Operation, scope: Scope, left: tsm.Expression, right: tsm.Expression) {
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

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_OR
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_AND
    function parseLogicalOperation(operator: tsm.SyntaxKind.BarBarToken | tsm.SyntaxKind.AmpersandAmpersandToken, scope: Scope, left: tsm.Expression, right: tsm.Expression) {
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
                ROA.concat<Operation>([endTarget])
            ))
        );
    }

    function parseStringConcat(scope: Scope, left: tsm.Expression, right: tsm.Expression): E.Either<ParseError, readonly Operation[]> {
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

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing
    // The nullish coalescing (??) operator is a logical operator that returns its right-hand side operand
    // when its left-hand side operand is null or undefined, and otherwise returns its left-hand side operand.
    function parseNullishCoalescing(scope: Scope, left: tsm.Expression, right: tsm.Expression) {
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

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/in
    // The in operator returns true if the specified property is in the specified object or its prototype chain.
    function parseInOperator(scope: Scope, left: tsm.Expression, right: tsm.Expression): E.Either<ParseError, readonly Operation[]> {
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

     // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Comma_operator
    // The comma (,) operator evaluates each of its operands (from left to right) 
    // and returns the value of the last operand.
    function parseCommaOperator(scope: Scope, left: tsm.Expression, right: tsm.Expression) {
        const needsDrop = tsm.Node.isExpression(left)
            && !isVoidLike(left.getType())
            && !TS.isAssignmentExpression(left);
        const dropOps = needsDrop
            ? ROA.of<Operation>({ kind: "drop" })
            : ROA.empty;

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


export const parseBinaryExpression =
    (scope: Scope) =>
        (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {
            
            const operator = TS.getBinaryOperator(node);
            const left = node.getLeft();
            const right = node.getRight();

            if (operator === tsm.SyntaxKind.EqualsToken) {
                const loadOps = pipe(right, parseExpression(scope))
                // todo: left store ops
                return E.left(makeParseError(node)(`assignment not yet implemented`));
            } else {
                const mappedOperator = TS.compoundAssignmentOperatorMap.get(operator);
                if (mappedOperator) {
                    const loadOps = parseBinaryOperatorExpression(scope, mappedOperator, left, right);
                    // todo: left store ops
                    return E.left(makeParseError(node)(`assignment not yet implemented`));
                } else {
                    return pipe(
                        parseBinaryOperatorExpression(scope, operator, left, right),
                        E.mapLeft(msg => typeof msg === "string" ? makeParseError(node)(msg) : msg)
                    );
                }
            }
        }

export function parseExpression(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

        switch (node.getKind()) {
            case tsm.SyntaxKind.AsExpression: return parseAsExpression(scope)(node as tsm.AsExpression);
            case tsm.SyntaxKind.BigIntLiteral: return parseBigIntLiteral(node as tsm.BigIntLiteral);
            case tsm.SyntaxKind.BinaryExpression: return parseBinaryExpression(scope)(node as tsm.BinaryExpression);
            case tsm.SyntaxKind.CallExpression: return parseCallExpression(scope)(node as tsm.CallExpression);
            case tsm.SyntaxKind.FalseKeyword: return parseBooleanLiteral(node as tsm.FalseLiteral);
            case tsm.SyntaxKind.Identifier: return parseIdentifier(scope)(node as tsm.Identifier);
            case tsm.SyntaxKind.NewExpression: return parseNewExpression(scope)(node as tsm.NewExpression);
            case tsm.SyntaxKind.NullKeyword: return parseNullLiteral(node);
            case tsm.SyntaxKind.NumericLiteral: return parseNumericLiteral(node as tsm.NumericLiteral);
            case tsm.SyntaxKind.PropertyAccessExpression: return parsePropertyAccessExpression(scope)(node as tsm.PropertyAccessExpression);
            case tsm.SyntaxKind.StringLiteral: return parseStringLiteral(node as tsm.StringLiteral);
            case tsm.SyntaxKind.TrueKeyword: return parseBooleanLiteral(node as tsm.TrueLiteral);

            default:
                return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} not impl`));
        };
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

function resolveIdentifier(scope: Scope) {
    return (node: tsm.Identifier): O.Option<CompileTimeObject> => {
        return pipe(
            node,
            TS.getSymbol,
            O.chain(resolve(scope))
        );
    };
}

function resolvePropertyAccessExpression(scope: Scope) {
    return (node: tsm.PropertyAccessExpression): O.Option<CompileTimeObject> => {
        const expr = node.getExpression();
        return pipe(
            node,
            // first, get the property symbol
            TS.getSymbol,
            O.chain(symbol => pipe(
                // next, try and resolve the property on the CTO directly
                expr,
                resolveExpression(scope),
                O.chain(getProperty(symbol)),
                // Finally, if the CTO doesn't contain the property,
                // try and resolve the property on the expression's type CTO
                O.alt(() => pipe(
                    expr.getType(),
                    TS.getTypeSymbol,
                    O.chain(q => {
                        return resolveType(scope)(q);
                    }),
                    O.chain(getProperty(symbol))
                ))
            )),
        );
    }

    function getProperty(symbol: tsm.Symbol) {
        return (cto: CompileTimeObject): O.Option<CompileTimeObject> => {
            return pipe(
                cto.getProperty,
                O.fromNullable,
                O.chain(getProperty => getProperty(symbol))
            )
        }
    }
}

export function resolveExpression(scope: Scope) {
    return (node: tsm.Expression): O.Option<CompileTimeObject> => {

        switch (node.getKind()) {
            case tsm.SyntaxKind.Identifier: return resolveIdentifier(scope)(node as tsm.Identifier);
            case tsm.SyntaxKind.PropertyAccessExpression: return resolvePropertyAccessExpression(scope)(node as tsm.PropertyAccessExpression);
        };

        return O.none;
    };
}

