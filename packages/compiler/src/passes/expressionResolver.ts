import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as TS from "../TS";
import { ParseError, makeParseError } from "../utils";
import { Operation, pushInt, pushString } from "../types/Operation";


export interface ExpressionTree {
    readonly node: tsm.Node;
}

export interface IdentifierExpressionTree extends ExpressionTree {
    readonly node: tsm.Identifier | tsm.ShorthandPropertyAssignment
    readonly symbol: tsm.Symbol;
}

export function isIdentifierET(tree: ExpressionTree): tree is IdentifierExpressionTree {
    return 'symbol' in tree;
}

export interface ParentExpressionTree extends ExpressionTree {
    readonly node: tsm.Expression & { getExpression(): tsm.Expression; };
    readonly child: ExpressionTree;
}

export function isParentET(tree: ExpressionTree): tree is ParentExpressionTree {
    return 'child' in tree;
}

export interface LiteralExpressionTree extends ExpressionTree {
    readonly node: tsm.StringLiteral | tsm.NumericLiteral | tsm.BigIntLiteral | tsm.BooleanLiteral | tsm.NullLiteral;
    readonly literal: string | bigint | boolean | null;
    readonly loadOp: Operation;
}

export function isLiteralET(tree: ExpressionTree): tree is LiteralExpressionTree {
    return 'literal' in tree;
}

export interface ArrayExpressionTree extends ExpressionTree {
    readonly node: tsm.ArrayLiteralExpression;
    readonly elements: readonly ExpressionTree[];
}

export function isArrayET(tree: ExpressionTree): tree is ArrayExpressionTree {
    return 'elements' in tree;
}

export interface ObjectExpressionTree extends ExpressionTree {
    readonly node: tsm.ObjectLiteralExpression;
    readonly properties: readonly {
        readonly key: tsm.Symbol;
        readonly value: ExpressionTree;
    }[];
}

export function isObjectET(tree: ExpressionTree): tree is ObjectExpressionTree {
    return 'properties' in tree;
}

export interface BinaryExpressionTree extends ExpressionTree {
    readonly node: tsm.BinaryExpression;
    readonly left: ExpressionTree;
    readonly right: ExpressionTree;
    readonly operator: tsm.ts.BinaryOperator;
}

export function isBinaryET(tree: ExpressionTree): tree is BinaryExpressionTree {
    return "left" in tree && "right" in tree && 'operator' in tree;
}
export interface AssignmentExpressionTree extends ExpressionTree {
    readonly node: tsm.BinaryExpression;
    readonly location: ExpressionTree; // left side of the assignment
    readonly value: ExpressionTree; // right side of the assignment
}

export function isAssignmentET(tree: ExpressionTree): tree is AssignmentExpressionTree {
    return "location" in tree && "value" in tree;
}

export interface ConditionalExpressionTree extends ExpressionTree {
    readonly node: tsm.ConditionalExpression;
    readonly condition: ExpressionTree;
    readonly whenTrue: ExpressionTree;
    readonly whenFalse: ExpressionTree;
}

export function isConditionalET(tree: ExpressionTree): tree is ConditionalExpressionTree {
    return "condition" in tree && "whenTrue" in tree && "whenFalse" in tree;
}

export interface PrefixUnaryExpressionTree extends ExpressionTree {
    readonly node: tsm.PrefixUnaryExpression;
    readonly operand: ExpressionTree;
    readonly prefix: tsm.ts.PrefixUnaryOperator;
}

export function isPrefixUnaryET(tree: ExpressionTree): tree is PrefixUnaryExpressionTree {
    return "operand" in tree && "prefix" in tree;
}

export interface PostfixUnaryExpressionTree extends ExpressionTree {
    readonly node: tsm.PostfixUnaryExpression;
    readonly operand: ExpressionTree;
    readonly postfix: tsm.ts.PostfixUnaryOperator;
}

export function isPostfixUnaryET(tree: ExpressionTree): tree is PostfixUnaryExpressionTree {
    return "operand" in tree && "postfix" in tree;
}

export interface CallExpressionTree extends ExpressionTree {
    readonly node: tsm.CallExpression;
    readonly expression: ExpressionTree;
    readonly callArgs: readonly ExpressionTree[];
}

export function isCallET(tree: ExpressionTree): tree is CallExpressionTree {
    return "expression" in tree && "callArgs" in tree;
}

export interface ConstructorExpressionTree extends ExpressionTree {
    readonly node: tsm.NewExpression;
    readonly expression: ExpressionTree;
    readonly constructorArgs: readonly ExpressionTree[];
}

export function isConstructorET(tree: ExpressionTree): tree is ConstructorExpressionTree {
    return "expression" in tree && "constructorArgs" in tree;
}

export interface ElementAccessExpressionTree extends ExpressionTree {
    readonly element: ExpressionTree;
    readonly expression: ExpressionTree;
}

export function isElementAccessET(tree: ExpressionTree): tree is ElementAccessExpressionTree {
    return "element" in tree && "expression" in tree;
}

export interface PropertyAccessExpressionTree extends ExpressionTree {
    readonly property: tsm.Symbol;
    readonly expression: ExpressionTree;
}

export function isPropertyAccessET(tree: ExpressionTree): tree is PropertyAccessExpressionTree {
    return "property" in tree && "expression" in tree;
}

function resolveBigIntLiteral(node: tsm.BigIntLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue() as bigint;
    return E.of({
        node,
        literal,
        loadOp: pushInt(literal)
    });
}

function resolveBooleanLiteral(node: tsm.BooleanLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    return E.of({
        node,
        literal,
        loadOp: { kind: 'pushbool', value: node.getLiteralValue() }
    });
}

function resolveNullLiteral(node: tsm.NullLiteral): E.Either<ParseError, LiteralExpressionTree> {
    return E.of({
        node,
        literal: null,
        loadOp: { kind: 'pushnull' }
    });
}

function resolveNumericLiteral(node: tsm.NumericLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    if (Number.isInteger(literal)) {
        return E.of({
            node,
            literal: BigInt(literal),
            loadOp: pushInt(literal)
        });
    }

    return E.left(makeParseError(node)(`invalid non-integer numeric literal ${literal}`));
}

function resolveStringLiteral(node: tsm.StringLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    return E.of({
        node,
        literal,
        loadOp: pushString(literal)
    });
}

const resolveIdentifier =
    (node: tsm.Identifier): E.Either<ParseError, IdentifierExpressionTree> => {
        return pipe(
            node,
            TS.parseSymbol,
            E.map(symbol => <IdentifierExpressionTree>{ node, symbol })
        )
    }

const resolveArrayLiteralExpression =
    (node: tsm.ArrayLiteralExpression): E.Either<ParseError, ArrayExpressionTree> => {
        return pipe(
            node.getElements(),
            ROA.map(resolveExpression),
            ROA.sequence(E.Applicative),
            E.map(elements => <ArrayExpressionTree>{
                node,
                elements,
            })
        )
    }

const resolveObjectLiteralPropertyAssignment =
    (node: tsm.PropertyAssignment): E.Either<ParseError, ExpressionTree> => {
        return pipe(
            node.getInitializer(),
            E.fromNullable(makeParseError(node)(`missing initializer`)),
            E.chain(resolveExpression)
        );
    }

const resolveObjectLiteralShorthandPropertyAssignment =
    (node: tsm.ShorthandPropertyAssignment): E.Either<ParseError, ExpressionTree> => {
        return pipe(
            node.getObjectAssignmentInitializer(),
            E.fromPredicate(
                init => !init,
                () => makeParseError(node)(`shorthand initializer not supported`)
            ),
            E.chain(() => TS.parseSymbol(node)),
            E.map(symbol => <IdentifierExpressionTree>{ node, symbol })
        )
    }

const resolveObjectLiteralProperty = dispatchResolve({
    [tsm.SyntaxKind.PropertyAssignment]: resolveObjectLiteralPropertyAssignment,
    [tsm.SyntaxKind.ShorthandPropertyAssignment]: resolveObjectLiteralShorthandPropertyAssignment,
});

export const resolveObjectLiteralExpression =
    (node: tsm.ObjectLiteralExpression): E.Either<ParseError, ObjectExpressionTree> => {
        return pipe(
            node.getProperties(),
            ROA.map(prop => {
                return pipe(
                    E.Do,
                    E.bind('key', () => TS.parseSymbol(prop)),
                    E.bind('value', () => resolveObjectLiteralProperty(prop))
                );
            }),
            ROA.sequence(E.Applicative),
            E.map(properties => <ObjectExpressionTree>{
                node,
                properties,
            })
        )
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
    (node: tsm.BinaryExpression): E.Either<ParseError, AssignmentExpressionTree | BinaryExpressionTree> => {

        return pipe(
            E.Do,
            E.bind('left', () => resolveExpression(node.getLeft())),
            E.bind('right', () => resolveExpression(node.getRight())),
            E.map(({ left, right }) => {
                const operator = node.getOperatorToken().getKind() as tsm.ts.BinaryOperator;
                if (operator === tsm.SyntaxKind.EqualsToken) {
                    return <AssignmentExpressionTree>{ node, location: left, value: right }
                }

                const mappedOperator = compoundAssignmentOperatorMap.get(operator);
                if (mappedOperator) {
                    const value: BinaryExpressionTree = { node, left, right, operator: mappedOperator };
                    return <AssignmentExpressionTree>{ node, location: left, value, };
                }

                return <BinaryExpressionTree>{ node, left, right, operator }
            })
        )
    }

const resolveConditionalExpression =
    (node: tsm.ConditionalExpression): E.Either<ParseError, ConditionalExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('condition', () => resolveExpression(node.getCondition())),
            E.bind('whenTrue', () => resolveExpression(node.getWhenTrue())),
            E.bind('whenFalse', () => resolveExpression(node.getWhenFalse())),
            E.map(({ condition, whenTrue, whenFalse }) => <ConditionalExpressionTree>{
                condition,
                whenTrue,
                whenFalse,
            })
        );
    }

const resolvePrefixUnaryExpression =
    (node: tsm.PrefixUnaryExpression): E.Either<ParseError, PrefixUnaryExpressionTree> => {
        return pipe(
            node.getOperand(),
            resolveExpression,
            E.map(operand => <PrefixUnaryExpressionTree>{
                node,
                prefix: node.getOperatorToken(),
                operand,
            })
        );
    }

const resolvePostfixUnaryExpression =
    (node: tsm.PostfixUnaryExpression): E.Either<ParseError, PostfixUnaryExpressionTree> => {
        return pipe(
            node.getOperand(),
            resolveExpression,
            E.map(operand => <PostfixUnaryExpressionTree>{
                node,
                postfix: node.getOperatorToken(),
                operand,
            })
        );
    }

const resolveCallExpression =
    (node: tsm.CallExpression): E.Either<ParseError, CallExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('expression', () => resolveExpression(node.getExpression())),
            E.bind('callArgs', () => pipe(
                node,
                TS.getArguments,
                ROA.map(resolveExpression),
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
    (node: tsm.NewExpression): E.Either<ParseError, ConstructorExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('expression', () => resolveExpression(node.getExpression())),
            E.bind('constructorArgs', () => pipe(
                node,
                TS.getArguments,
                ROA.map(resolveExpression),
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
    (node: tsm.PropertyAccessExpression): E.Either<ParseError, PropertyAccessExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('property', () => pipe(
                node.getSymbol(),
                E.fromNullable(makeParseError(node)(`missing symbol`))
            )),
            E.bind('expression', () => resolveExpression(node.getExpression())),
            E.map(({ property, expression }) => <PropertyAccessExpressionTree>{
                node,
                property,
                expression,
            })
        );
    }

const resolveParent = (node: tsm.Expression & { getExpression(): tsm.Expression; }): E.Either<ParseError, ParentExpressionTree> => {
    return pipe(
        node.getExpression(),
        resolveExpression,
        E.map(child => <ParentExpressionTree>{
            node,
            child,
        })
    )
}

const resolveElementAccessExpression =
    (node: tsm.ElementAccessExpression): E.Either<ParseError, ElementAccessExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('element', () => pipe(
                node.getArgumentExpression(),
                E.fromNullable(makeParseError(node)(`missing argument expression`)),
                E.chain(resolveExpression)
            )),
            E.bind('expression', () => resolveExpression(node.getExpression())),
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

function dispatchResolve(dispatchMap: ResolveDispatchMap) {
    return (node: tsm.Node) => {
        const dispatchFunction = dispatchMap[node.getKind()];
        return dispatchFunction
            ? dispatchFunction(node as any)
            : E.left(makeParseError(node)(`${node.getKindName()} not supported`));
    };
}

export const resolveExpression = dispatchResolve({
    [tsm.SyntaxKind.ArrayLiteralExpression]: resolveArrayLiteralExpression,
    [tsm.SyntaxKind.AwaitExpression]: node => E.left(makeParseError(node)(`await expression not supported`)),
    [tsm.SyntaxKind.AsExpression]: resolveParent,
    [tsm.SyntaxKind.BigIntLiteral]: resolveBigIntLiteral,
    [tsm.SyntaxKind.BinaryExpression]: resolveBinaryExpression,
    [tsm.SyntaxKind.CallExpression]: resolveCallExpression,
    [tsm.SyntaxKind.ConditionalExpression]: resolveConditionalExpression,
    [tsm.SyntaxKind.ElementAccessExpression]: resolveElementAccessExpression,
    [tsm.SyntaxKind.FalseKeyword]: resolveBooleanLiteral,
    [tsm.SyntaxKind.Identifier]: resolveIdentifier,
    [tsm.SyntaxKind.NewExpression]: resolveNewExpression,
    [tsm.SyntaxKind.NonNullExpression]: resolveParent,
    [tsm.SyntaxKind.NullKeyword]: resolveNullLiteral,
    [tsm.SyntaxKind.NumericLiteral]: resolveNumericLiteral,
    [tsm.SyntaxKind.ObjectLiteralExpression]: resolveObjectLiteralExpression,
    [tsm.SyntaxKind.ParenthesizedExpression]: resolveParent,
    [tsm.SyntaxKind.PostfixUnaryExpression]: resolvePostfixUnaryExpression,
    [tsm.SyntaxKind.PrefixUnaryExpression]: resolvePrefixUnaryExpression,
    [tsm.SyntaxKind.PropertyAccessExpression]: resolvePropertyAccessExpression,
    [tsm.SyntaxKind.StringLiteral]: resolveStringLiteral,
    [tsm.SyntaxKind.TrueKeyword]: resolveBooleanLiteral,
});


// export function generateLoad(tree: ExpressionTree): E.Either<ParseError, readonly Operation[]> {
//     if (isIdentifierET(tree)) {
//         return pipe(tree.object.loadOps, E.fromNullable(makeParseError(tree.node)(`missing load ops`)));
//     }
//     if (isParentET(tree)) { return generateLoad(tree.child); }
//     if (isLiteralET(tree)) { return pipe(tree.loadOp, ROA.of, E.of); }
//     if (isArrayET(tree)) { return genLoadArrayET(tree) }
//     if (isObjectET(tree)) { return genLoadObjectET(tree) }
//     // binary ET
//     // SyntaxKind.AsteriskAsteriskToken
//     // SyntaxKind.AsteriskToken
//     // SyntaxKind.SlashToken
//     // SyntaxKind.PercentToken;
//     // SyntaxKind.PlusToken
//     // SyntaxKind.MinusToken
//     // SyntaxKind.LessThanLessThanToken
//     // SyntaxKind.GreaterThanGreaterThanToken
//     // SyntaxKind.GreaterThanGreaterThanGreaterThanToken
//     // SyntaxKind.LessThanToken
//     // SyntaxKind.LessThanEqualsToken
//     // SyntaxKind.GreaterThanToken
//     // SyntaxKind.GreaterThanEqualsToken
//     // SyntaxKind.InstanceOfKeyword
//     // SyntaxKind.InKeyword
//     // SyntaxKind.EqualsEqualsToken
//     // SyntaxKind.EqualsEqualsEqualsToken
//     // SyntaxKind.ExclamationEqualsEqualsToken
//     // SyntaxKind.ExclamationEqualsToken
//     // SyntaxKind.AmpersandToken
//     // SyntaxKind.BarToken
//     // SyntaxKind.CaretToken;
//     // SyntaxKind.AmpersandAmpersandToken
//     // SyntaxKind.BarBarToken;
//     // SyntaxKind.QuestionQuestionToken
//     // SyntaxKind.CommaToken;

//     // assignment ET

//     if (isConditionalET(tree)) { return genLoadConditionalET(tree); }

//     // prefixUnary
//     // SyntaxKind.PlusPlusToken
//     // incr
//     // SyntaxKind.MinusMinusToken
//     // decr
//     // SyntaxKind.PlusToken
//     // convert expr
//     // SyntaxKind.MinusToken
//     // conver expr + negeate
//     // SyntaxKind.TildeToken
//     // conver expr + invert
//     // SyntaxKind.ExclamationToken
//     // conver expr as bool + not

//     if (isPostfixUnaryET(tree)) { return genLoadPostfixUnaryET(tree) }

//     // call
//     // new
//     // elementAccess
//     // propertyAccess

//     return E.left(makeParseError(tree.node)("unkown expression tree"));
// }

// function genLoadPostfixUnaryET(tree: PostfixUnaryExpressionTree): E.Either<ParseError, readonly Operation[]> {
//     return pipe(
//         tree.operand,
//         generateLoad,
//         E.bindTo('ops'),
//         E.bind('operator', () => {
//             switch (tree.postfix) {
//                 case tsm.SyntaxKind.PlusPlusToken: return E.of(<Operation>{ kind: "increment" });
//                 case tsm.SyntaxKind.MinusMinusToken: return E.of(<Operation>{ kind: "decrement" });
//                 default: return E.left(makeParseError(tree.node)(`invalid postfix operator ${tsm.SyntaxKind[tree.postfix]}`));
//             }
//         }),
//         E.map(({ ops, operator }) => ROA.append(operator)(ops))
//     );
// }

// function genLoadConditionalET(tree: ConditionalExpressionTree): E.Either<ParseError, readonly Operation[]> {
//     const falseTarget: Operation = { kind: "noop" };
//     const endTarget: Operation = { kind: "noop" };
//     return pipe(
//         E.Do,
//         E.bind('condition', () => generateLoad(tree.condition)),
//         E.bind('whenTrue', () => generateLoad(tree.whenTrue)),
//         E.bind('whenFalse', () => generateLoad(tree.whenFalse)),
//         E.map(({ condition, whenTrue, whenFalse }) => pipe(
//             condition,
//             ROA.append({ kind: 'jumpifnot', target: falseTarget } as Operation),
//             ROA.concat(whenTrue),
//             ROA.append({ kind: 'jump', target: endTarget } as Operation),
//             ROA.append(falseTarget as Operation),
//             ROA.concat(whenFalse),
//             ROA.append(endTarget as Operation)
//         ))
//     );
// }

// function genLoadObjectET(tree: ObjectExpressionTree): E.Either<ParseError, readonly Operation[]> {
//     return pipe(
//         tree.properties,
//         ROA.map(({ key, value }) => pipe(
//             generateLoad(value),
//             E.map(ROA.append<Operation>(pushString(key.getName())))
//         )),
//         ROA.sequence(E.Applicative),
//         E.map(ROA.flatten),
//         E.map(ROA.append<Operation>(pushInt(tree.properties.length))),
//         E.map(ROA.append<Operation>({ kind: 'packmap' }))
//     );
// }

// function genLoadArrayET(tree: ArrayExpressionTree): E.Either<ParseError, readonly Operation[]> {
//     return pipe(
//         tree.elements,
//         ROA.reverse,
//         ROA.map(generateLoad),
//         ROA.sequence(E.Applicative),
//         E.map(ROA.flatten),
//         E.map(ROA.append<Operation>(pushInt(tree.elements.length))),
//         E.map(ROA.append<Operation>({ kind: 'packarray' }))
//     );
// }
