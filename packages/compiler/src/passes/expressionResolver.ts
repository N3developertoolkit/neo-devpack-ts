import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import { CompileError, ParseError, isStringLike, isVoidLike, makeParseError } from "../utils";
import { Operation, getBooleanConvertOps, getStringConvertOps, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, Scope, resolve, resolveType } from "../types/CompileTimeObject";

export interface ExpressionTree {
    readonly node: tsm.Node;

    // readonly resolve?: (scope: Scope) => E.Either<ParseError, ExpressionTree>;
    readonly load?: (scope: Scope) => E.Either<ParseError, readonly Operation[]>;
    readonly store?: (scope: Scope) => E.Either<ParseError, readonly Operation[]>;
}

// function hasResolve(tree: ExpressionTree): tree is ExpressionTree & { readonly resolve: (scope: Scope) => E.Either<ParseError, CompileTimeObject> } {
//     return "resolve" in tree;
// }

function hasLoad(tree: ExpressionTree): tree is ExpressionTree & { readonly load: (scope: Scope) => E.Either<ParseError, readonly Operation[]> } {
    return "load" in tree;
}

function hasStore(tree: ExpressionTree): tree is ExpressionTree & { readonly store: (scope: Scope) => E.Either<ParseError, readonly Operation[]> } {
    return "store" in tree;
}

// function resolveTree(scope: Scope) {
//     return (tree: ExpressionTree): E.Either<ParseError, ExpressionTree> => {
//         if (tree.resolve)
//             return tree.resolve(scope);
//         return E.left(makeParseError(tree.node)(`resolveTree unsupported expression tree ${tree.node.getKindName()}`));
//     };
// }

// const resolveTypeOrSymbol =
//     (scope: Scope) =>
//         (tree: ExpressionTree) => {
//             return pipe(
//                 tree.node.getType(),
//                 TS.getTypeSymbol,
//                 O.chain(resolveType(scope)),
//                 O.match(
//                     () => pipe(tree, resolveTree(scope)),
//                     E.of
//                 )
//             );
//         }

function loadTree(scope: Scope) {
    return (tree: ExpressionTree): E.Either<ParseError, readonly Operation[]> => {
        if (tree.load)
            return tree.load(scope);
        return E.left(makeParseError(tree.node)(`storeTree unsupported expression tree ${tree.node.getKindName()}`));
    };
}

const loadTreeAsBoolean = (scope: Scope) => (tree: ExpressionTree): E.Either<ParseError, readonly Operation[]> => {
    const convertOps = getBooleanConvertOps(tree.node.getType());
    return pipe(tree, loadTree(scope), E.map(ROA.concat(convertOps)));
}

const loadTreeAsString = (scope: Scope) => (tree: ExpressionTree): E.Either<ParseError, readonly Operation[]> => {
    const convertOps = getStringConvertOps(tree.node.getType());
    return pipe(tree, loadTree(scope), E.map(ROA.concat(convertOps)));
}

function storeTree(scope: Scope) {
    return (tree: ExpressionTree): E.Either<ParseError, readonly Operation[]> => {
        if (tree.store)
            return tree.store(scope);
        return E.left(makeParseError(tree.node)(`storeTree unsupported expression tree ${tree.node.getKindName()}`));
    };
}

function getStoreOps(cto: CompileTimeObject) {
    return pipe(
        cto.storeOps,
        E.fromNullable(makeParseError(cto.node)(`${cto.node.getText()} does not support assignment`))
    );
}

function getLoadOps(cto: CompileTimeObject) {
    return pipe(
        cto.loadOps,
        E.fromNullable(makeParseError(cto.node)(`${cto.node.getText()} does not support loading`))
    );
}

function getProperty(cto: CompileTimeObject, symbol: tsm.Symbol) {
    return pipe(
        cto.getProperty,
        O.fromNullable,
        O.chain(getProp => getProp(symbol)),
        E.fromOption(() => makeParseError(cto.node)(`failed to resolve ${symbol.getName()} property`))
    )
}

export class IdentifierExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.Identifier | tsm.ShorthandPropertyAssignment,
        readonly symbol: tsm.Symbol) { }

    // readonly resolve = (scope: Scope) => pipe(
    //     this.symbol,
    //     resolve(scope),
    //     E.fromOption(() => makeParseError(this.node)(`Could not resolve symbol ${this.symbol.getName()}`))
    // );

    // readonly load = (scope: Scope) => pipe(
    //     this.resolve(scope),
    //     E.chain(getLoadOps)
    // )

    // readonly store = (scope: Scope) => pipe(
    //     this.resolve(scope),
    //     E.chain(getStoreOps)
    // )
}

export class ParentExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.Expression & { getExpression(): tsm.Expression; },
        readonly child: ExpressionTree
    ) { }

    // readonly resolve = (scope: Scope) => resolveTree(scope)(this.child);
    readonly load = (scope: Scope) => loadTree(scope)(this.child);
    readonly store = (scope: Scope) => storeTree(scope)(this.child);
}

export class LiteralExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.StringLiteral | tsm.NumericLiteral | tsm.BigIntLiteral | tsm.BooleanLiteral | tsm.NullLiteral,
        readonly literal: string | bigint | boolean | null,
    ) { 
        if (typeof literal === 'string') this.loadOp = pushString(literal);
        else if (typeof literal === 'bigint') this.loadOp = pushInt(literal);
        else if (typeof literal === 'boolean') this.loadOp = { kind: 'pushbool', value: literal };
        else if (literal === null) this.loadOp = { kind: 'pushnull' };
        else throw new CompileError("invalid literal type", this.node);
    }

    private readonly loadOp: Operation;
    readonly load = (_scope: Scope) => E.of([this.loadOp])
}

export class ArrayExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.ArrayLiteralExpression,
        readonly elements: readonly ExpressionTree[],
    ) { }

    readonly load = (scope: Scope) => pipe(
        this.elements,
        ROA.reverse,
        ROA.map(loadTree(scope)),
        ROA.sequence(E.Applicative),
        E.map(ROA.flatten),
        E.map(ROA.append<Operation>(pushInt(this.elements.length))),
        E.map(ROA.append<Operation>({ kind: 'packarray' }))
    )
}

export class ObjectExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.ObjectLiteralExpression,
        readonly properties: readonly {
            readonly key: tsm.Symbol;
            readonly value: ExpressionTree;
        }[],
    ) { }

    readonly load = (scope: Scope) => pipe(
        this.properties,
        ROA.map(({ key, value }) => pipe(
            loadTree(scope)(value),
            E.map(ROA.append<Operation>(pushString(key.getName())))
        )),
        ROA.sequence(E.Applicative),
        E.map(ROA.flatten),
        E.map(ROA.append<Operation>(pushInt(this.properties.length))),
        E.map(ROA.append<Operation>({ kind: 'packmap' }))
    )
}

export class BinaryExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.BinaryExpression,
        readonly left: ExpressionTree,
        readonly right: ExpressionTree,
        readonly operator: tsm.ts.BinaryOperator,
    ) { }


    readonly load = (scope: Scope) => {
        // for string types and the plus token, use concat instead of add
        if (this.operator === tsm.SyntaxKind.PlusToken && isStringLike(this.left.node.getType())) {
            return this.loadStringConcat(scope);
        }

        const operatorOperation = BinaryExpressionTree.binaryOperationMap.get(this.operator);
        if (operatorOperation) {
            return this.loadOperatorOperation(scope, operatorOperation);
        }

        switch (this.operator) {
            case tsm.SyntaxKind.QuestionQuestionToken:
                return this.loadNullishCoalescing(scope);
            case tsm.SyntaxKind.CommaToken:
                return this.loadCommaOperator(scope);
            case tsm.SyntaxKind.BarBarToken:
            case tsm.SyntaxKind.AmpersandAmpersandToken:
                return this.loadLogicalOperation(scope, this.operator);
            case tsm.SyntaxKind.InKeyword:
                return this.loadInOperator(scope);
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Unsigned_right_shift
            case tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof
            case tsm.SyntaxKind.InstanceOfKeyword:
                return E.left(makeParseError(this.node)(`${tsm.SyntaxKind[this.operator]} operator not supported`));
        }

        return E.left(makeParseError(this.node)(`Invalid binary operator ${tsm.SyntaxKind[this.operator]}`));
    }

    private loadOperatorOperation(scope: Scope, operatorOperation: Operation) {
        return pipe(
            E.Do,
            E.bind('leftOps', () => loadTree(scope)(this.left)),
            E.bind('rightOps', () => loadTree(scope)(this.right)),
            E.map(({ leftOps, rightOps }) => pipe(
                leftOps,
                ROA.concat(rightOps),
                ROA.append(operatorOperation)
            ))
        );
    }

    private loadStringConcat(scope: Scope): E.Either<ParseError, readonly Operation[]> {
        return pipe(
            E.Do,
            E.bind('leftOps', () => loadTree(scope)(this.left)),
            E.bind('rightOps', () => loadTreeAsString(scope)(this.right)),
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
    private loadNullishCoalescing(scope: Scope) {
        const endTarget: Operation = { kind: "noop" };
        return pipe(
            E.Do,
            E.bind('leftOps', () => loadTree(scope)(this.left)),
            E.bind('rightOps', () => loadTree(scope)(this.right)),
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
    private loadInOperator(scope: Scope): E.Either<ParseError, readonly Operation[]> {
        return pipe(
            E.Do,
            E.bind('leftOps', () => loadTree(scope)(this.left)),
            E.bind('rightOps', () => loadTree(scope)(this.right)),
            E.map(({ leftOps, rightOps }) => pipe(
                rightOps,
                ROA.concat(leftOps),
                ROA.append<Operation>({ kind: "haskey" })
            ))
        );
    }

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_OR
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Logical_AND
    private loadLogicalOperation(
        scope: Scope,
        operator: tsm.SyntaxKind.BarBarToken | tsm.SyntaxKind.AmpersandAmpersandToken,
    ) {
        const rightTarget: Operation = { kind: "noop" };
        const endTarget: Operation = { kind: "noop" };

        const logicalOps: readonly Operation[] = operator === tsm.SyntaxKind.BarBarToken
            ? [{ kind: "jumpifnot", target: rightTarget }, { kind: "pushbool", value: true }]
            : [{ kind: "jumpif", target: rightTarget }, { kind: "pushbool", value: false }];

        return pipe(
            E.Do,
            E.bind('left', () => loadTreeAsBoolean(scope)(this.left)),
            E.bind('right', () => loadTreeAsBoolean(scope)(this.right)),
            E.map(({ left, right }) => pipe(
                left,
                ROA.concat(logicalOps),
                ROA.concat<Operation>([{ kind: "jump", target: endTarget }, rightTarget]),
                ROA.concat(right),
                ROA.concat<Operation>([endTarget])
            ))
        );
    }

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Comma_operator
    // The comma (,) operator evaluates each of its operands (from left to right) 
    // and returns the value of the last operand.
    private loadCommaOperator(scope: Scope) {
        const leftNode = this.left.node;
        const needsDrop = tsm.Node.isExpression(leftNode)
            && !isVoidLike(leftNode.getType())
            && !TS.isAssignmentExpression(leftNode);
        const dropOps = needsDrop
            ? ROA.of<Operation>({ kind: "drop" })
            : ROA.empty;

        return pipe(
            E.Do,
            E.bind('leftOps', () => loadTree(scope)(this.left)),
            E.bind('rightOps', () => loadTree(scope)(this.right)),
            E.map(({ leftOps, rightOps }) => pipe(
                leftOps,
                ROA.concat(dropOps),
                ROA.concat(rightOps)
            ))
        );
    }

    static readonly binaryOperationMap = new Map<tsm.SyntaxKind, Operation>([
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
}

export class AssignmentExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.BinaryExpression,
        readonly location: ExpressionTree, // left side of the assignment
        readonly value: ExpressionTree // right side of the assignment
    ) { }

    // readonly load = (scope: Scope) => pipe(
    //     E.Do,
    //     E.bind('valueOps', () => pipe(this.value, loadTree(scope))),
    //     E.bind('storeOps', () => pipe(
    //         this.location,
    //         resolveTree(scope),
    //         E.chain(storeTree(scope))
    //     )),
    //     E.map(({ valueOps, storeOps }) => ROA.concat(storeOps)(valueOps))
    // )
}

export class ConditionalExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.ConditionalExpression,
        readonly condition: ExpressionTree,
        readonly whenTrue: ExpressionTree,
        readonly whenFalse: ExpressionTree,
    ) { }

    readonly load = (scope: Scope) => {
        const falseTarget: Operation = { kind: "noop" };
        const endTarget: Operation = { kind: "noop" };
        return pipe(
            E.Do,
            E.bind('condition', () => loadTree(scope)(this.condition)),
            E.bind('whenTrue', () => loadTree(scope)(this.whenTrue)),
            E.bind('whenFalse', () => loadTree(scope)(this.whenFalse)),
            E.map(({ condition, whenTrue, whenFalse }) => pipe(
                condition,
                ROA.append({ kind: 'jumpifnot', target: falseTarget } as Operation),
                ROA.concat(whenTrue),
                ROA.append({ kind: 'jump', target: endTarget } as Operation),
                ROA.append(falseTarget as Operation),
                ROA.concat(whenFalse),
                ROA.append(endTarget as Operation)
            ))
        );
    }
}

export class PrefixUnaryExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.PrefixUnaryExpression,
        readonly operand: ExpressionTree,
        readonly operator: tsm.ts.PrefixUnaryOperator
    ) { }

    // readonly load = (scope: Scope) => {
    //     switch (this.operator) {
    //         case tsm.SyntaxKind.PlusToken:
    //             return pipe(this.operand, loadTree(scope));
    //         case tsm.SyntaxKind.MinusToken:
    //             return pipe(
    //                 this.operand,
    //                 loadTree(scope),
    //                 E.map(ROA.append<Operation>({ kind: "negate" }))
    //             );
    //         case tsm.SyntaxKind.TildeToken:
    //             return pipe(
    //                 this.operand,
    //                 loadTree(scope),
    //                 E.map(ROA.append<Operation>({ kind: "invert" }))
    //             );
    //         case tsm.SyntaxKind.ExclamationToken:
    //             return pipe(
    //                 this.operand,
    //                 loadTreeAsBoolean(scope),
    //                 E.map(ROA.append<Operation>({ kind: "not" }))
    //             );
    //         case tsm.SyntaxKind.PlusPlusToken:
    //         case tsm.SyntaxKind.MinusMinusToken: {
    //             const kind = this.operator === tsm.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
    //             return pipe(
    //                 this.operand,
    //                 resolveTree(scope),
    //                 E.bindTo('operand'),
    //                 E.bind('loadOps', ({ operand }) => getLoadOps(operand)),
    //                 E.bind('storeOps', ({ operand }) => getStoreOps(operand)),
    //                 E.map(({ loadOps, storeOps }) => pipe(
    //                     loadOps,
    //                     ROA.append<Operation>({ kind }),
    //                     ROA.append<Operation>({ kind: "duplicate" }),
    //                     ROA.concat(storeOps)
    //                 ))
    //             )
    //         }
    //     }
    //     return E.left(makeParseError(this.node)(`Invalid prefix unary operator ${tsm.SyntaxKind[this.operator]}`));
    // }
}

export class PostfixUnaryExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.PostfixUnaryExpression,
        readonly operand: ExpressionTree,
        readonly operator: tsm.ts.PostfixUnaryOperator,
    ) { }

    private getOperationKind(): E.Either<ParseError, "increment" | "decrement"> {
        switch (this.operator) {
            case tsm.SyntaxKind.PlusPlusToken: return E.of("increment");
            case tsm.SyntaxKind.MinusMinusToken: return E.of("decrement");
        }
        return E.left(makeParseError(this.node)(`Invalid postfix unary operator ${tsm.SyntaxKind[this.operator]}`));
    }

    // readonly load = (scope: Scope) => pipe(
    //     this.operand,
    //     resolveTree(scope),
    //     E.bindTo('operand'),
    //     E.bind('postfix', () => pipe(this.getOperationKind(), E.map(kind => (<Operation>{ kind })))),
    //     E.bind('loadOps', ({ operand }) => getLoadOps(operand)),
    //     E.bind('storeOps', ({ operand }) => getStoreOps(operand)),
    //     E.map(({ loadOps, storeOps, postfix }) => pipe(
    //         loadOps,
    //         ROA.append<Operation>({ kind: "duplicate" }),
    //         ROA.append(postfix),
    //         ROA.concat(storeOps)
    //     ))
    // )
}

export class CallExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.CallExpression,
        readonly expression: ExpressionTree,
        readonly callArgs: readonly ExpressionTree[],
    ) { }

    // readonly load = (scope: Scope) => {

    //     // for call expressions., we need 
    //     //  1. the load operations for the expression
    //     //  2. the call operations
    //     //  3. the load operations for each argument (in reverse order)
    //     //      - argument handling is done by the 


    //     // const q = pipe(
    //     //     this.expression, 
    //     //     resolveTree(scope),
    //     //     E.chain(getLoadOps)
            
    //     //     );
    //     return E.left(makeParseError(this.node)(`CallExpressionTree.load not implemented`));
    // }
}

export class ConstructorExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.NewExpression,
        readonly expression: ExpressionTree,
        readonly constructorArgs: readonly ExpressionTree[],
    ) { }
}

export class ElementAccessExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.ElementAccessExpression,
        readonly element: ExpressionTree,
        readonly expression: ExpressionTree,
    ) { }
}

export class PropertyAccessExpressionTree implements ExpressionTree {
    constructor(
        readonly node: tsm.PropertyAccessExpression,
        readonly property: tsm.Symbol,
        readonly expression: ExpressionTree
    ) { }

    // readonly load = (scope: Scope) => {
    //     const q = pipe(
    //         E.Do,
    //         E.bind('expr', () => resolveTree(scope)(this.expression)),
    //         E.bind('loadExpr', ({ expr }) => getLoadOps(expr)),
    //         E.bind('prop ', ({ expr }) => getProperty(expr, this.property)),
    //     )

    // }

}


function parseBigIntLiteralTree(node: tsm.BigIntLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue() as bigint;
    return E.of(new LiteralExpressionTree(node, literal));
}

function parseBooleanLiteralTree(node: tsm.BooleanLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    return E.of(new LiteralExpressionTree(node, literal));
}

function parseNullLiteralTree(node: tsm.NullLiteral): E.Either<ParseError, LiteralExpressionTree> {
    return E.of(new LiteralExpressionTree(node, null));
}

function parseNumericLiteralTree(node: tsm.NumericLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    return Number.isInteger(literal)
        ? E.of(new LiteralExpressionTree(node, BigInt(literal)))
        : E.left(makeParseError(node)(`invalid non-integer numeric literal ${literal}`));
}

function parseStringLiteralTree(node: tsm.StringLiteral): E.Either<ParseError, LiteralExpressionTree> {
    const literal = node.getLiteralValue();
    return E.of(new LiteralExpressionTree(node, literal));
}

const parseIdentifierTree =
    (node: tsm.Identifier): E.Either<ParseError, IdentifierExpressionTree> => {
        return pipe(
            node,
            TS.parseSymbol,
            E.map(symbol => new IdentifierExpressionTree(node, symbol))
        )
    }

const parseArrayLiteralExpressionTree =
    (node: tsm.ArrayLiteralExpression): E.Either<ParseError, ArrayExpressionTree> => {
        return pipe(
            node.getElements(),
            ROA.map(parseExpressionTree),
            ROA.sequence(E.Applicative),
            E.map(elements => new ArrayExpressionTree(node, elements))
        )
    }

const parseObjectLiteralPropertyAssignment =
    (node: tsm.PropertyAssignment): E.Either<ParseError, ExpressionTree> => {
        return pipe(
            node.getInitializer(),
            E.fromNullable(makeParseError(node)(`missing initializer`)),
            E.chain(parseExpressionTree)
        );
    }

const parseObjectLiteralShorthandPropertyAssignment =
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
    [tsm.SyntaxKind.PropertyAssignment]: parseObjectLiteralPropertyAssignment,
    [tsm.SyntaxKind.ShorthandPropertyAssignment]: parseObjectLiteralShorthandPropertyAssignment,
});

export const parseObjectLiteralExpressionTree =
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
            E.map(properties => new ObjectExpressionTree(node, properties))
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

const parseBinaryExpressionTree =
    (node: tsm.BinaryExpression): E.Either<ParseError, AssignmentExpressionTree | BinaryExpressionTree> => {

        return pipe(
            E.Do,
            E.bind('left', () => parseExpressionTree(node.getLeft())),
            E.bind('right', () => parseExpressionTree(node.getRight())),
            E.map(({ left, right }) => {
                const operator = node.getOperatorToken().getKind() as tsm.ts.BinaryOperator;
                if (operator === tsm.SyntaxKind.EqualsToken) {
                    return new AssignmentExpressionTree(node, left, right);
                }

                const mappedOperator = compoundAssignmentOperatorMap.get(operator);
                if (mappedOperator) {
                    const value = new BinaryExpressionTree(node, left, right, mappedOperator);
                    return new AssignmentExpressionTree(node, left, value);
                }

                return new BinaryExpressionTree(node, left, right, operator);
            })
        )
    }

const parseConditionalExpressionTree =
    (node: tsm.ConditionalExpression): E.Either<ParseError, ConditionalExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('condition', () => parseExpressionTree(node.getCondition())),
            E.bind('whenTrue', () => parseExpressionTree(node.getWhenTrue())),
            E.bind('whenFalse', () => parseExpressionTree(node.getWhenFalse())),
            E.map(({ condition, whenTrue, whenFalse }) => new ConditionalExpressionTree(node, condition, whenTrue, whenFalse))
        );
    }

const parsePrefixUnaryExpressionTree =
    (node: tsm.PrefixUnaryExpression): E.Either<ParseError, PrefixUnaryExpressionTree> => {
        return pipe(
            node.getOperand(),
            parseExpressionTree,
            E.map(operand => new PrefixUnaryExpressionTree(node, operand, node.getOperatorToken()))
        );
    }

const parsePostfixUnaryExpressionTree =
    (node: tsm.PostfixUnaryExpression): E.Either<ParseError, PostfixUnaryExpressionTree> => {
        return pipe(
            node.getOperand(),
            parseExpressionTree,
            E.map(operand => new PostfixUnaryExpressionTree(node, operand, node.getOperatorToken()))
        );
    }

const parseCallExpressionTree =
    (node: tsm.CallExpression): E.Either<ParseError, CallExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('expression', () => parseExpressionTree(node.getExpression())),
            E.bind('callArgs', () => pipe(
                node,
                TS.getArguments,
                ROA.map(parseExpressionTree),
                ROA.sequence(E.Applicative)
            )),
            E.map(({ expression, callArgs }) => new CallExpressionTree(node, expression, callArgs))
        );
    }

const parseNewExpressionTree =
    (node: tsm.NewExpression): E.Either<ParseError, ConstructorExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('expression', () => parseExpressionTree(node.getExpression())),
            E.bind('constructorArgs', () => pipe(
                node,
                TS.getArguments,
                ROA.map(parseExpressionTree),
                ROA.sequence(E.Applicative)
            )),
            E.map(({ expression, constructorArgs }) => new ConstructorExpressionTree(node, expression, constructorArgs))
        );
    }

const parsePropertyAccessExpressionTree =
    (node: tsm.PropertyAccessExpression): E.Either<ParseError, PropertyAccessExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('property', () => pipe(
                node.getSymbol(),
                E.fromNullable(makeParseError(node)(`missing symbol`))
            )),
            E.bind('expression', () => parseExpressionTree(node.getExpression())),
            E.map(({ property, expression }) => new PropertyAccessExpressionTree(node, property, expression))
        );
    }

const parseParentTree = (node: tsm.Expression & { getExpression(): tsm.Expression; }): E.Either<ParseError, ParentExpressionTree> => {
    return pipe(
        node.getExpression(),
        parseExpressionTree,
        E.map(child => new ParentExpressionTree(node, child))
    )
}

const parseElementAccessExpressionTree =
    (node: tsm.ElementAccessExpression): E.Either<ParseError, ElementAccessExpressionTree> => {
        return pipe(
            E.Do,
            E.bind('element', () => pipe(
                node.getArgumentExpression(),
                E.fromNullable(makeParseError(node)(`missing argument expression`)),
                E.chain(parseExpressionTree)
            )),
            E.bind('expression', () => parseExpressionTree(node.getExpression())),
            E.map(({ element, expression }) => new ElementAccessExpressionTree(node, element, expression))
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

export const parseExpressionTree = dispatchResolve({
    [tsm.SyntaxKind.ArrayLiteralExpression]: parseArrayLiteralExpressionTree,
    [tsm.SyntaxKind.AwaitExpression]: node => E.left(makeParseError(node)(`await expression not supported`)),
    [tsm.SyntaxKind.AsExpression]: parseParentTree,
    [tsm.SyntaxKind.BigIntLiteral]: parseBigIntLiteralTree,
    [tsm.SyntaxKind.BinaryExpression]: parseBinaryExpressionTree,
    [tsm.SyntaxKind.CallExpression]: parseCallExpressionTree,
    [tsm.SyntaxKind.ConditionalExpression]: parseConditionalExpressionTree,
    [tsm.SyntaxKind.ElementAccessExpression]: parseElementAccessExpressionTree,
    [tsm.SyntaxKind.FalseKeyword]: parseBooleanLiteralTree,
    [tsm.SyntaxKind.Identifier]: parseIdentifierTree,
    [tsm.SyntaxKind.NewExpression]: parseNewExpressionTree,
    [tsm.SyntaxKind.NonNullExpression]: parseParentTree,
    [tsm.SyntaxKind.NullKeyword]: parseNullLiteralTree,
    [tsm.SyntaxKind.NumericLiteral]: parseNumericLiteralTree,
    [tsm.SyntaxKind.ObjectLiteralExpression]: parseObjectLiteralExpressionTree,
    [tsm.SyntaxKind.ParenthesizedExpression]: parseParentTree,
    [tsm.SyntaxKind.PostfixUnaryExpression]: parsePostfixUnaryExpressionTree,
    [tsm.SyntaxKind.PrefixUnaryExpression]: parsePrefixUnaryExpressionTree,
    [tsm.SyntaxKind.PropertyAccessExpression]: parsePropertyAccessExpressionTree,
    [tsm.SyntaxKind.StringLiteral]: parseStringLiteralTree,
    [tsm.SyntaxKind.TrueKeyword]: parseBooleanLiteralTree,
});
