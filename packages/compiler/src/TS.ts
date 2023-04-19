import * as tsm from "ts-morph";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray'
import { pipe } from "fp-ts/lib/function";
import { ParseError, makeParseError } from "./utils";

export function getSymbol(node: tsm.Node) { return O.fromNullable(node.getSymbol()); }
export function getType(node: tsm.Node) { return node.getType(); }
export function getChildren(node: tsm.Node) { return node.forEachChildAsArray(); }

export function getArguments(node: tsm.CallExpression) {
    return ROA.fromArray(node.getArguments() as tsm.Expression[]);
}

export function getSymbolDeclarations(symbol: tsm.Symbol) {
    return symbol.getDeclarations();
}

export function getTypeSymbol(type: tsm.Type) { return O.fromNullable(type.getSymbol()) }

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

export const hasTag = (tagName: string) => (node: tsm.JSDocableNode) => O.isSome(getTag(tagName)(node));

export const getTagComment = (tagName: string) => (node: tsm.JSDocableNode) => pipe(
    node,
    getTag(tagName),
    O.chain(tag => O.fromNullable(tag.getCommentText()))
);

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

export function isAssignmentExpression(node: tsm.Expression) {
    if (tsm.Node.isBinaryExpression(node)) {
        const opKind = node.getOperatorToken().getKind();
        return opKind === tsm.SyntaxKind.EqualsToken || compoundAssignmentOperatorMap.has(opKind);
    } else {
        return false;
    }
}

export const parseSymbol = (node: tsm.Node): E.Either<ParseError, tsm.Symbol> => {
    return pipe(
        node,
        getSymbol,
        E.fromOption(() => makeParseError(node)('invalid symbol'))
    );
};