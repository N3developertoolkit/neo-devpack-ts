import * as tsm from "ts-morph";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray'
import { pipe } from "fp-ts/lib/function";

export const getSymbol = (node: tsm.Node) => O.fromNullable(node.getSymbol());
export const getType = (node: tsm.Node) => node.getType();
export const getChildren = (node: tsm.Node) => node.forEachChildAsArray();

export const getSymbolDeclarations = (symbol: tsm.Symbol) => symbol.getDeclarations();

export const getTypeProperty = (name: string) => (type: tsm.Type) => O.fromNullable(type.getProperty(name));
export const getTypeProperties = (type: tsm.Type) => ROA.fromArray(type.getProperties());

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