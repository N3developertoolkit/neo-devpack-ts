import { Node, SyntaxKind, KindToNodeMappings, JSDocableNode, JSDocTag } from "ts-morph";
import { CompileError } from "./compiler";

// declare module 'ts-morph' {
//     interface JSDocableNode {
//         getJsDocTag(tagName: string): JSDocTag | undefined;
//     }   
// }

// JSDocableNode.prototype.getJsDocTags

// export function getJSDocTag(node: JSDocableNode, tagName: string): JSDocTag | undefined {
//     for (const doc of node.getJsDocs()) {
//         for (const tag of doc.getTags()) {
//             if (tag.getTagName() === tagName) return tag;
//         }
//     }
//     return undefined
// }

Node.prototype.getSymbolOrThrow = function() {
    const sym = this.getSymbol();
    if (!sym) throw new CompileError("undefined symbol", this);
    return sym;
}

Node.prototype.asKindOrThrow = function<TKind extends SyntaxKind>(kind: TKind): KindToNodeMappings[TKind] {
    const node = this.asKind(kind);
    if (!node) throw new CompileError(`expected ${SyntaxKind[kind]}`, this);
    return node;
}
