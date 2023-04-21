import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as TS from "../TS";
import { CompileTimeObject, Scope, resolve, resolveName } from "../types/CompileTimeObject";
import { ParseError, makeParseError } from "../utils";
import { pushInt, pushString } from "../types/Operation";


interface ExpressionTree extends Omit<CompileTimeObject, 'symbol'> {
    readonly node: tsm.Expression;
    readonly symbol?: tsm.Symbol;
}

interface ParentExpressionTree extends ExpressionTree {
    readonly node: tsm.Expression & { getExpression(): tsm.Expression; };
    readonly child: ExpressionTree;
}

interface LiteralExpressionTree extends ExpressionTree {
    readonly node: tsm.StringLiteral | tsm.NumericLiteral | tsm.BigIntLiteral | tsm.BooleanLiteral | tsm.NullLiteral;
    readonly literal: string | bigint | boolean | null;
}

interface ArrayExpressionTree extends ExpressionTree {
    readonly node: tsm.ArrayLiteralExpression;
    readonly elements: readonly ExpressionTree[];
}

interface ObjectExpressionTreeProperty {
    readonly key: tsm.Symbol;
    readonly value: CompileTimeObject;
};

interface ObjectExpressionTree extends ExpressionTree {
    readonly node: tsm.ObjectLiteralExpression;
    readonly properties: readonly ObjectExpressionTreeProperty[];
}

export interface BinaryExpressionTree extends ExpressionTree {
    readonly node: tsm.BinaryExpression;
    readonly left: ExpressionTree;
    readonly right: ExpressionTree;
    readonly operator: tsm.ts.BinaryOperator;
}

export interface AssignmentExpressionTree extends ExpressionTree {
    readonly node: tsm.BinaryExpression;
    readonly location: ExpressionTree; // left side of the assignment
    readonly value: ExpressionTree; // right side of the assignment
}

export interface ConditionalExpressionTree extends ExpressionTree {
    readonly node: tsm.ConditionalExpression;
    readonly condition: ExpressionTree;
    readonly whenTrue: ExpressionTree;
    readonly whenFalse: ExpressionTree;
}

export interface PrefixUnaryExpressionTree extends ExpressionTree {
    readonly node: tsm.PrefixUnaryExpression;
    readonly operand: ExpressionTree;
    readonly prefix: tsm.ts.PrefixUnaryOperator;
}

export interface PostfixUnaryExpressionTree extends ExpressionTree {
    readonly node: tsm.PostfixUnaryExpression;
    readonly operand: ExpressionTree;
    readonly postfix: tsm.ts.PostfixUnaryOperator;
}

export interface CallExpressionTree extends ExpressionTree {
    readonly node: tsm.CallExpression;
    readonly expression: ExpressionTree;
    readonly callArgs: readonly ExpressionTree[];
}

export interface ConstructorExpressionTree extends ExpressionTree {
    readonly node: tsm.NewExpression;
    readonly expression: ExpressionTree;
    readonly constructorArgs: readonly ExpressionTree[];
}


export interface ElementAccessExpressionTree extends ExpressionTree {
    readonly element: ExpressionTree;
    readonly expression: ExpressionTree;
}

export interface PropertyAccessExpressionTree extends ExpressionTree {
    readonly property: tsm.Symbol;
    readonly expression: ExpressionTree;
}

function resolveBigIntLiteral(node: tsm.BigIntLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue() as bigint;
    return E.of({
        node,
        literal,
        loadOps: [pushInt(literal)]
    });
}

function resolveBooleanLiteral(node: tsm.BooleanLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    return E.of({
        node,
        literal,
        loadOps: [{ kind: 'pushbool', value: node.getLiteralValue() }]
    });
}

function resolveNullLiteral(node: tsm.NullLiteral): E.Either<ParseError, LiteralExpressionTree> {
    return E.of({
        node,
        literal: null,
        loadOps: [{ kind: 'pushnull' }]
    });
}

function resolveNumericLiteral(node: tsm.NumericLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    if (Number.isInteger(literal)) {
        return E.of({
            node,
            literal: BigInt(literal),
            loadOps: [pushInt(literal)]
        });
    }

    return E.left(makeParseError(node)(`invalid non-integer numeric literal ${literal}`));
}

function resolveStringLiteral(node: tsm.StringLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    return E.of({
        node,
        literal,
        loadOps: [pushString(literal)]
    });
}

const resolveIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, ExpressionTree> => {
            return pipe(
                node,
                TS.parseSymbol,
                E.chain(symbol => pipe(
                    symbol,
                    resolve(scope),
                    E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} symbol`)),
                    E.map(cto => cto as ExpressionTree)
                ))
            )
        }

const resolveArrayLiteralExpression =
    (scope: Scope) =>
        (node: tsm.ArrayLiteralExpression): E.Either<ParseError, ArrayExpressionTree> => {
            return pipe(
                node.getElements(),
                ROA.map(resolveExpression(scope)),
                ROA.sequence(E.Applicative),
                E.map(elements => <ArrayExpressionTree>{
                    node,
                    symbol: node.getSymbol(),
                    elements,
                    // TODO: loadOps
                })
            )
        }

export const resolveObjectLiteralExpression =
    (scope: Scope) =>
        (node: tsm.ObjectLiteralExpression): E.Either<ParseError, ObjectExpressionTree> => {

            return pipe(
                node.getProperties(),
                ROA.map(prop => {
                    return pipe(
                        E.Do,
                        E.bind('key', () => pipe(prop, TS.parseSymbol)),
                        E.bind('value', () => resolveProperty(prop))
                    );
                }),
                ROA.sequence(E.Applicative),
                E.map(properties => <ObjectExpressionTree>{
                    node,
                    symbol: node.getSymbol(),
                    properties,
                    // TODO: loadOps
                })
            )

            function resolveProperty(prop: tsm.ObjectLiteralElementLike): E.Either<ParseError, ExpressionTree> {

                if (tsm.Node.isPropertyAssignment(prop)) {
                    return pipe(
                        prop.getInitializer(),
                        E.fromNullable(makeParseError(node)(`missing initializer`)),
                        E.chain(resolveExpression(scope))
                    );
                }

                if (tsm.Node.isShorthandPropertyAssignment(prop)) {
                    return pipe(
                        prop.getObjectAssignmentInitializer(),
                        O.fromNullable,
                        O.match(
                            () => pipe(
                                prop,
                                TS.parseSymbol,
                                E.map(s => s.getName()),
                                E.chain(name => pipe(
                                    name,
                                    resolveName(scope),
                                    E.fromOption(() => makeParseError(node)(`failed to resolve "${name}"`))
                                )),
                                E.map(cto => cto as ExpressionTree)
                            ),
                            resolveExpression(scope)
                        )
                    );
                }

                return E.left(makeParseError(node)(`unsupported property type ${prop.getKindName()}`));
            }
        }

const compoundAssignmentOperatorMap = new Map<tsm.SyntaxKind, tsm.ts.BinaryOperator>([
    [tsm.SyntaxKind.PlusEqualsToken, tsm.ts.SyntaxKind.PlusToken],
    [tsm.SyntaxKind.MinusEqualsToken, tsm.SyntaxKind.MinusToken],
    [tsm.SyntaxKind.AsteriskAsteriskEqualsToken, tsm.SyntaxKind.AsteriskAsteriskToken],
    [tsm.SyntaxKind.AsteriskEqualsToken, tsm.SyntaxKind.AsteriskToken],
    [tsm.SyntaxKind.SlashEqualsToken, tsm.SyntaxKind.SlashToken],
    [tsm.SyntaxKind.PercentEqualsToken, tsm.SyntaxKind.PercentToken],
    [tsm.SyntaxKind.AmpersandEqualsToken, tsm.SyntaxKind.AmpersandToken],
    [tsm.SyntaxKind.BarEqualsToken, tsm.SyntaxKind.BarToken],
    [tsm.SyntaxKind.CaretEqualsToken, tsm.SyntaxKind.CaretToken],
    [tsm.SyntaxKind.LessThanLessThanEqualsToken, tsm.SyntaxKind.LessThanLessThanToken],
    [tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanToken],
    [tsm.SyntaxKind.GreaterThanGreaterThanEqualsToken, tsm.SyntaxKind.GreaterThanGreaterThanToken],
    [tsm.SyntaxKind.BarBarEqualsToken, tsm.SyntaxKind.BarBarToken],
    [tsm.SyntaxKind.AmpersandAmpersandEqualsToken, tsm.SyntaxKind.AmpersandAmpersandToken],
    [tsm.SyntaxKind.QuestionQuestionEqualsToken, tsm.SyntaxKind.QuestionQuestionToken],
]) as ReadonlyMap<tsm.SyntaxKind, tsm.ts.BinaryOperator>;

const resolveBinaryExpression =
    (scope: Scope) =>
        (node: tsm.BinaryExpression): E.Either<ParseError, AssignmentExpressionTree | BinaryExpressionTree> => {

            return pipe(
                E.Do,
                E.bind('left', () => resolveExpression(scope)(node.getLeft())),
                E.bind('right', () => resolveExpression(scope)(node.getRight())),
                E.map(({ left, right }) => {
                    const operator = node.getOperatorToken().getKind() as tsm.ts.BinaryOperator;
                    if (operator === tsm.SyntaxKind.EqualsToken) {
                        return <AssignmentExpressionTree>{ node, location: left, value: right }
                    }

                    const compoundAssignmentOperator = compoundAssignmentOperatorMap.get(operator);
                    if (compoundAssignmentOperator) {
                        const value: BinaryExpressionTree = { node, left, right, operator: compoundAssignmentOperator };
                        return <AssignmentExpressionTree>{ node, location: left, value, };
                    }

                    return <BinaryExpressionTree>{ node, left, right, operator }
                })
            )
        }

const resolveConditionalExpression =
    (scope: Scope) =>
        (node: tsm.ConditionalExpression): E.Either<ParseError, ConditionalExpressionTree> => {
            return pipe(
                E.Do,
                E.bind('condition', () => resolveExpression(scope)(node.getCondition())),
                E.bind('whenTrue', () => resolveExpression(scope)(node.getWhenTrue())),
                E.bind('whenFalse', () => resolveExpression(scope)(node.getWhenFalse())),
                E.map(({ condition, whenTrue, whenFalse }) => <ConditionalExpressionTree>{
                    condition,
                    whenTrue,
                    whenFalse,
                })
            );
        }

const resolvePrefixUnaryExpression =
    (scope: Scope) =>
        (node: tsm.PrefixUnaryExpression): E.Either<ParseError, PrefixUnaryExpressionTree> => {
            return pipe(
                node.getOperand(),
                resolveExpression(scope),
                E.map(operand => <PrefixUnaryExpressionTree>{
                    node,
                    prefix: node.getOperatorToken(),
                    operand,
                })
            );
        }

const resolvePostfixUnaryExpression =
    (scope: Scope) =>
        (node: tsm.PostfixUnaryExpression): E.Either<ParseError, PostfixUnaryExpressionTree> => {
            return pipe(
                node.getOperand(),
                resolveExpression(scope),
                E.map(operand => <PostfixUnaryExpressionTree>{
                    node,
                    postfix: node.getOperatorToken(),
                    operand,
                })
            );
        }

const resolveCallExpression =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, CallExpressionTree> => {
            return pipe(
                E.Do,
                E.bind('expression', () => resolveExpression(scope)(node.getExpression())),
                E.bind('callArgs', () => pipe(
                    node,
                    TS.getArguments,
                    ROA.map(resolveExpression(scope)),
                    ROA.sequence(E.Applicative)
                )),
                E.map(({ expression, callArgs }) => <CallExpressionTree>{
                    node,
                    expression,
                    callArgs,
                })
            );
        }

const resolveNewExpression =
    (scope: Scope) =>
        (node: tsm.NewExpression): E.Either<ParseError, ConstructorExpressionTree> => {
            return pipe(
                E.Do,
                E.bind('expression', () => resolveExpression(scope)(node.getExpression())),
                E.bind('constructorArgs', () => pipe(
                    node,
                    TS.getArguments,
                    ROA.map(resolveExpression(scope)),
                    ROA.sequence(E.Applicative)
                )),
                E.map(({ expression, constructorArgs }) => <ConstructorExpressionTree>{
                    node,
                    expression,
                    constructorArgs,
                })
            );
        }

const resolvePropertyAccessExpression =
    (scope: Scope) =>
        (node: tsm.PropertyAccessExpression): E.Either<ParseError, PropertyAccessExpressionTree> => {
            return pipe(
                E.Do,
                E.bind('property', () => pipe(
                    node.getSymbol(),
                    E.fromNullable(makeParseError(node)(`missing symbol`))
                )),
                E.bind('expression', () => resolveExpression(scope)(node.getExpression())),
                E.map(({ property, expression }) => <PropertyAccessExpressionTree>{
                    node,
                    property,
                    expression,
                })
            );
        }

const resolveParent = (scope: Scope) => 
    (node: tsm.Expression & { getExpression(): tsm.Expression; }): E.Either<ParseError, ParentExpressionTree> => {
        return pipe(
            node.getExpression(),
            resolveExpression(scope),
            E.map(child => <ParentExpressionTree>{
                node,
                child,
            })
        )
    }

const resolveElementAccessExpression =
    (scope: Scope) =>
        (node: tsm.ElementAccessExpression): E.Either<ParseError, ElementAccessExpressionTree> => {
            return pipe(
                E.Do,
                E.bind('element', () => pipe(
                    node.getArgumentExpression(),
                    E.fromNullable(makeParseError(node)(`missing argument expression`)),
                    E.chain(resolveExpression(scope))
                )),
                E.bind('expression', () => resolveExpression(scope)(node.getExpression())),
                E.map(({ element, expression }) => <ElementAccessExpressionTree>{
                    node,
                    element,
                    expression,
                })
            );
        }


type ResolveDispatchMap = {
    [TKind in tsm.SyntaxKind]?: (node: tsm.KindToNodeMappings[TKind]) => E.Either<ParseError, ExpressionTree>;
};

function dispatchResolve(node: tsm.Node, dispatchMap: ResolveDispatchMap) {
    const dispatchFunction = dispatchMap[node.getKind()];
    return dispatchFunction
        ? dispatchFunction(node as any)
        : E.left(makeParseError(node)(`dispatch ${node.getKindName()} failed`));
}



export function resolveExpression(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, ExpressionTree> => {

        const dispatchMap: ResolveDispatchMap = {
            [tsm.SyntaxKind.ArrayLiteralExpression]: resolveArrayLiteralExpression(scope),
            [tsm.SyntaxKind.AwaitExpression]: node => E.left(makeParseError(node)(`await expression not supported`)),
            [tsm.SyntaxKind.AsExpression]: resolveParent(scope),
            [tsm.SyntaxKind.BigIntLiteral]: resolveBigIntLiteral,
            [tsm.SyntaxKind.BinaryExpression]: resolveBinaryExpression(scope),
            [tsm.SyntaxKind.CallExpression]: resolveCallExpression(scope),
            [tsm.SyntaxKind.ConditionalExpression]: resolveConditionalExpression(scope),
            [tsm.SyntaxKind.ElementAccessExpression]: resolveElementAccessExpression(scope),
            [tsm.SyntaxKind.FalseKeyword]: resolveBooleanLiteral,
            [tsm.SyntaxKind.Identifier]: resolveIdentifier(scope),
            [tsm.SyntaxKind.NewExpression]: resolveNewExpression(scope),
            [tsm.SyntaxKind.NonNullExpression]: resolveParent(scope),
            [tsm.SyntaxKind.NullKeyword]: resolveNullLiteral,
            [tsm.SyntaxKind.NumericLiteral]: resolveNumericLiteral,
            [tsm.SyntaxKind.ObjectLiteralExpression]: resolveObjectLiteralExpression(scope),
            [tsm.SyntaxKind.ParenthesizedExpression]: resolveParent(scope),
            [tsm.SyntaxKind.PostfixUnaryExpression]: resolvePostfixUnaryExpression(scope),
            [tsm.SyntaxKind.PrefixUnaryExpression]: resolvePrefixUnaryExpression(scope),
            [tsm.SyntaxKind.PropertyAccessExpression]: resolvePropertyAccessExpression(scope),
            [tsm.SyntaxKind.StringLiteral]: resolveStringLiteral,
            [tsm.SyntaxKind.TrueKeyword]: resolveBooleanLiteral,
        };

        return dispatchResolve(node, dispatchMap);
    };
}