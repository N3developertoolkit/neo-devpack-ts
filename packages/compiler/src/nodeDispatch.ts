import * as tsm from "ts-morph";
import { CompileError } from "./compiler";

type DispatchFunction<T extends tsm.Node> = (node: T) => void;

export type NodeDispatchMap = {
    [TKind in tsm.SyntaxKind]?: DispatchFunction<tsm.KindToNodeMappings[TKind]>
};

export function dispatch(node: tsm.Node, dispatchMap: NodeDispatchMap, missing?: (node: tsm.Node) => void) {
    const kind = node.getKind();
    const dispatchFunction = dispatchMap[kind];
    if (dispatchFunction) {
        dispatchFunction(node as any);
    } else {
        if (missing) {
            missing(node);
        } else {
            throw new CompileError(`dispatch ${node.getKindName()} failed`, node);
        }
    }
}
