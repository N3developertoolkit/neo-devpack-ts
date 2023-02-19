// import * as tsm from "ts-morph";
// import { CompileContext, CompileError } from "../compiler";
// import { MethodSymbolDef, ReadonlyScope } from "../scope";
// import { Operation } from "../types/Operation";
// import { MethodBuilder } from "./MethodBuilder";
// import { processStatement } from "./statementProcessor";

// export interface ContractMethod {
//     def: MethodSymbolDef,
//     operations: ReadonlyArray<Operation>,
//     variables: ReadonlyArray<{ name: string, type: tsm.Type }>,
// }

//     // const name = node.getNameOrThrow();
//         // name,
//         // safe: hasSafeTag(node),
//         // public: !!node.getExportKeyword(),
//         // returnType: node.getReturnType(),
//         // parameters: node.getParameters().map(p => ({ name: p.getName(), type: p.getType(), })),
//         // variables: builder.getVariables(),
//         // operations: builder.getOperations()

// export interface ProcessMethodOptions {
//     diagnostics: tsm.ts.Diagnostic[];
//     builder: MethodBuilder,
//     scope: ReadonlyScope,
// }

// // @internal
// export function processMethodDef(def: MethodSymbolDef, diagnostics: Array<tsm.ts.Diagnostic>): ContractMethod {

//     const node = def.node;
//     const body = node.getBodyOrThrow();
//     if (!tsm.Node.isStatement(body)) {
//         throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
//     }

//     const builder = new MethodBuilder(node.getParameters().length);
//     processStatement(body, { diagnostics, builder, scope: def });

//     return {
//         def,
//         operations: builder.getOperations(),
//         variables: builder.getVariables(),
//     }
// }

// export function processMethodDefinitions(context: CompileContext) {

//     for (const scope of context.scopes) {
//         for (const def of scope.symbols) {
//             if (def instanceof MethodSymbolDef) {
//                 const method = processMethodDef(def, context.diagnostics);
//                 context.methods.push(method);
//             }
//         }
//     }
// }
