// import { Node, SyntaxKind, KindToNodeMappings, JSDocableNode, JSDocTag } from "ts-morph";
// import { CompileError } from "./compiler";

// Node.prototype.getSymbolOrThrow = function() {
//     const sym = this.getSymbol();
//     if (!sym) throw new CompileError("undefined symbol", this);
//     return sym;
// }

// Node.prototype.asKindOrThrow = function<TKind extends SyntaxKind>(kind: TKind): KindToNodeMappings[TKind] {
//     const node = this.asKind(kind);
//     if (!node) throw new CompileError(`expected ${SyntaxKind[kind]}`, this);
//     return node;
// }
