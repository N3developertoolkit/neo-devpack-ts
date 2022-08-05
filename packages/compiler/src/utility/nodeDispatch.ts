import * as tsm from "ts-morph";
import { CompileError } from "../compiler";

export type NodeDispatchMap<TOptions> = {
    [TKind in tsm.SyntaxKind]?: (node: tsm.KindToNodeMappings[TKind], options: TOptions) => void;
};

export function dispatch<TOptions>(node: tsm.Node, options: TOptions, dispatchMap: NodeDispatchMap<TOptions>, missing?: (node: tsm.Node) => void) {
    const kind = node.getKind();
    const dispatchFunction = dispatchMap[kind];
    if (dispatchFunction) {
        dispatchFunction(node as any, options);
    } else {
        if (missing) {
            missing(node);
        } else {
            throw new CompileError(`dispatch ${node.getKindName()} failed`, node);
        }
    }
}
