import * as tsm from "ts-morph";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray'
import { identity, pipe } from "fp-ts/lib/function";
import { ParseError, makeParseError } from "./utils";

export function getSymbol(node: tsm.Node) { return O.fromNullable(node.getSymbol()); }
export function getType(node: tsm.Node) { return node.getType(); }
export function getChildren(node: tsm.Node) { return node.forEachChildAsArray(); }

export function getArguments(node: tsm.CallExpression | tsm.NewExpression) {
    return ROA.fromArray(node.getArguments() as tsm.Expression[]);
}

export function getSymbolDeclarations(symbol: tsm.Symbol) {
    return symbol.getDeclarations();
}

export function getTypeSymbol(type: tsm.Type) { return O.fromNullable(type.getSymbol()) }

export function isIterableType(type: tsm.Type): boolean {
    const props = type.getProperties();
    return pipe(
        props, 
        ROA.map(s => s.getValueDeclaration()),
        ROA.filterMap(O.fromPredicate(tsm.Node.isMethodDeclaration)),
        ROA.map(d => d.getNameNode()),
        ROA.filterMap(O.fromPredicate(tsm.Node.isComputedPropertyName)),
        ROA.map(n => n.getExpression()),
        ROA.filterMap(O.fromPredicate(tsm.Node.isPropertyAccessExpression)),
        ROA.map(pa => [pa.getExpression().getSymbol()?.getName(), pa.getName()] as const),
        ROA.findFirst(([exprName, name]) => exprName === "Symbol" && name === "iterator"),
        O.isSome,
    );
}

export const getTypeProperty =
    (type: tsm.Type) =>
        (name: string) =>
            O.fromNullable(type.getProperty(name));

export function getTypeProperties(type: tsm.Type) {
    return ROA.fromArray(type.getProperties());
}

export const getTypeDeclarations = (node: tsm.Node) => {
    return pipe(
        node,
        getType,
        getTypeSymbol,
        O.map(getSymbolDeclarations),
    )
}

export const getTag = (tagName: string) => (node: tsm.JSDocableNode): O.Option<tsm.JSDocTag> => {
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() === tagName)
                return O.some(tag);
        }
    }
    return O.none;
};


export const getTags = (tagName: string) => (node: tsm.JSDocableNode): readonly tsm.JSDocTag[] => {
    let tags = [];
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() === tagName)
                tags.push(tag);
        }
    }
    return tags;
};

export const hasTag = (tagName: string) => (node: tsm.JSDocableNode) => O.isSome(getTag(tagName)(node));

export const getTagComment = (tagName: string) => (node: tsm.JSDocableNode) => pipe(
    node,
    getTag(tagName),
    O.chain(tag => O.fromNullable(tag.getCommentText()))
);

export const getTagComments = (tagName: string) => (node: tsm.JSDocableNode) => {
    return pipe(
        node,
        getTags(tagName),
        ROA.map(tag => O.fromNullable(tag.getCommentText())),
        ROA.filterMap(identity)
    )
}
export const getExpression =
    (node: tsm.Expression): O.Option<tsm.Expression> =>
        tsm.Node.hasExpression(node)
            ? O.of(node.getExpression())
            : O.none;

export type MemberedNode = tsm.TypeElementMemberedNode & { getSymbol(): tsm.Symbol | undefined, getType(): tsm.Type };

export function isMethodOrProp(node: tsm.Node): node is (tsm.MethodSignature | tsm.PropertySignature) {
    const kind = node.getKind();
    return kind === tsm.SyntaxKind.MethodSignature || kind === tsm.SyntaxKind.PropertySignature;
}

export const getMember =
    (name: string) =>
        (decl: MemberedNode) => {
            return pipe(
                // use getType().getProperties() to get all members in the inheritance chain
                decl.getType(),
                getTypeProperties,
                ROA.chain(s => s.getDeclarations()),
                ROA.filter(isMethodOrProp),
                ROA.findFirst(m => m.getSymbol()?.getName() === name),
            )
        }

export const getPropertyMember = (name: string) => (node: MemberedNode) => {
    return pipe(
        node,
        getMember(name),
        O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
        O.bindTo('sig'),
        O.bind('symbol', ({ sig }) => getSymbol(sig)),
        O.map(({ sig, symbol }) => [sig, symbol] as const)
    );
}

export const getMethodMember = (name: string) => (node: MemberedNode) => {
    return pipe(
        node,
        getMember(name),
        O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
        O.bindTo('sig'),
        O.bind('symbol', ({ sig }) => getSymbol(sig)),
        O.map(({ sig, symbol }) => [sig, symbol] as const)
    );
}

export function getPropSig(symbol: tsm.Symbol) {
    return pipe(
        symbol.getValueDeclaration(),
        O.fromNullable,
        O.chain(decl => pipe(decl.asKind(tsm.SyntaxKind.PropertySignature), O.fromNullable)),
    );
}

export function getMethodSig(symbol: tsm.Symbol) {
    return pipe(
        symbol.getValueDeclaration(),
        O.fromNullable,
        O.chain(decl => pipe(decl.asKind(tsm.SyntaxKind.MethodSignature), O.fromNullable)),
    );
}

export const compoundAssignmentOperatorMap = new Map<tsm.SyntaxKind, tsm.ts.BinaryOperator>([
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

export function isAssignmentExpression(node: tsm.Expression) {
    if (!tsm.Node.isBinaryExpression(node)) return false;
    const opKind = node.getOperatorToken().getKind();
    return opKind === tsm.SyntaxKind.EqualsToken || compoundAssignmentOperatorMap.has(opKind);
}

export function getBinaryOperator(node: tsm.BinaryExpression) {
    return node.getOperatorToken().getKind() as tsm.ts.BinaryOperator;
}

export const parseSymbol = (node: tsm.Node): E.Either<ParseError, tsm.Symbol> => {
    return pipe(
        node,
        getSymbol,
        E.fromOption(() => makeParseError(node)('invalid symbol'))
    );
};

export function getEnumValue(member: tsm.EnumMember): E.Either<string, number | string> {
    const value = member.getValue();

    if (value === undefined) {
        return E.left(`${member.getParent().getName()}.${member.getName()} undefined value`);
    }

    if (typeof value === 'number') {
        return Number.isInteger(value)
            ? E.of(value)
            : E.left(`${member.getParent().getName()}.${member.getName()} invalid non-integer numeric literal ${value}`);
    }
    
    return E.of(value);
}