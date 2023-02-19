// import * as tsm from "ts-morph";
// import { CompileError } from "../compiler";

// export type NodeDispatchMap<TOptions> = {
//     [TKind in tsm.SyntaxKind]?: (node: tsm.KindToNodeMappings[TKind], options: TOptions) => void;
// };

// export function dispatch<TOptions>(node: tsm.Node, options: TOptions, dispatchMap: NodeDispatchMap<TOptions>, missing?: (error: CompileError) => void) {
//     const kind = node.getKind();
//     const dispatchFunction = dispatchMap[kind];
//     if (dispatchFunction) {
//         dispatchFunction(node as any, options);
//     } else {
//         const error = new CompileError(`dispatch ${node.getKindName()} failed`, node);
//         if (missing) {
//             missing(error);
//         } else {
//             throw error;
//         }
//     }
// }

// export function transform<TResult, TContext = undefined>(
//     node: tsm.Node, 
//     map: {
//         [TKind in tsm.SyntaxKind]?: (node: tsm.KindToNodeMappings[TKind], context?: TContext) => TResult }, 
//     options?: {
//         context?: TContext, 
//         missing?: (node: tsm.Node) => TResult }
// ) {
//     const {context, missing} = options ?? {};
//     const func = map[node.getKind()];
//     if (func) {
//         return func(node as any, context);
//     } else {
//         if (missing) {
//             return missing(node);
//         } else {
//             throw new CompileError(`transform ${node.getKindName()} failed`, node);
//         }
//     }
// }
