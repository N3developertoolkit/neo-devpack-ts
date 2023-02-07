import * as tsm from "ts-morph";
import { CompileContext, CompileError } from "../compiler";
import { MethodSymbolDef, ReadonlyScope } from "../scope";
import { Operation } from "../types/Operation";
import { MethodBuilder } from "./MethodBuilder";
import { processStatement } from "./statementProcessor";
// import { processStatement } from "./statementProcessor"







// // function processBoolean(value: boolean, options: ProcessOptions) {
// //     options.builder.pushInt(value ? 1 : 0);
// //     options.builder.pushConvert(sc.StackItemType.Boolean);
// // }

// // export function processArguments(args: tsm.Node[], options: ProcessOptions) {
// //     const argsLength = args.length;
// //     for (let i = argsLength - 1; i >= 0; i--) {
// //         const arg = args[i];
// //         if (tsm.Node.isExpression(arg)) {
// //             processExpression(arg, options);
// //         } else {
// //             throw new CompileError(`Unexpected call arg kind ${arg.getKindName()}`, arg);
// //         }
// //     }
// // }

// // function processOptionalChain(hasQuestionDot: boolean, options: ProcessOptions, func: (options: ProcessOptions) => void) {
// //     const { builder } = options;
// //     if (hasQuestionDot) {
// //         const endTarget: TargetOffset = { operation: undefined };
// //         builder.push(OperationKind.DUP); //.set(node.getOperatorToken());
// //         builder.push(OperationKind.ISNULL);
// //         builder.pushJump(OperationKind.JMPIF, endTarget);
// //         func(options);
// //         endTarget.operation = builder.push(OperationKind.NOP).instruction;
// //     } else {
// //         func(options);
// //     }
// // }

// // // function processBoolean(value: boolean, options: ProcessOptions) {
// // //     const builder = options.builder;
// // //     const opCode = value ? OpCode.PUSH1 : OpCode.PUSH0;
// // //     builder.push(opCode);
// // //     builder.pushConvert(StackItemType.Boolean);
// // // }

// // function loadSymbolDef(resolved: SymbolDef, options: ProcessOptions) {
// //     if (resolved instanceof ParameterSymbolDef) {
// //         options.builder.pushLoad("parameter", resolved.index);
// //         return;
// //     }

// //     if (resolved instanceof VariableSymbolDef) {
// //         options.builder.pushLoad(resolved.slotType, resolved.index);
// //         return;
// //     }

// //     throw new Error(`loadSymbolDef failure`);
// // }

// // function storeSymbolDef(resolved: SymbolDef, options: ProcessOptions) {
// //     if (resolved instanceof ParameterSymbolDef) {
// //         options.builder.pushStore("parameter", resolved.index);
// //         return;
// //     }

// //     if (resolved instanceof VariableSymbolDef) {
// //         options.builder.pushStore(resolved.slotType, resolved.index);
// //         return;
// //     }

// //     throw new Error(`storeSymbolDef failure`);

// // }

// // function processSymbolDefinition(resolved: SymbolDefinition | undefined, node: tsm.Node, options: ProcessOptions) {
// //     if (!resolved) { throw new CompileError(`failed to resolve`, node); }

// //     if (resolved instanceof ParameterSymbolDefinition) {
// //         options.builder.pushLoad(SlotType.Parameter, resolved.index);
// //         return;
// //     }

// //     if (resolved instanceof VariableSymbolDefinition) {
// //         options.builder.pushLoad(SlotType.Local, resolved.index);
// //         return;
// //     }

// //     if (resolved instanceof FunctionSymbolDefinition) {
// //         options.builder.pushCall(resolved);
// //         return;
// //     }

// //     throw new CompileError(`${resolved.symbol.getName()} not implemented`, node);
// // }

// function oldprocessFunctionDeclaration(symbolDef: FunctionSymbolDef, context: CompileContext) {
//     const node = symbolDef.node;
//     const body = node.getBodyOrThrow();
//     if (!tsm.Node.isStatement(body)) {
//         throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
//     }

//     const params = node.getParameters();
//     const builder = new FunctionBuilder(params.length);
//     // processStatement(body, { builder, scope: symbolDef, });
//     builder.pushReturn();
//     // context.functions.push({
//     //     node,
//     //     operations: [...builder.operations],
//     //     locals: builder.locals,
//     // })
// }


function hasSafeTag(node: tsm.JSDocableNode): boolean {
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            const tagName = tag.getTagName();
            if (tagName === "safe") {
                return true;
            }
        }
    }
    return false;
}

export interface ContractMethod {
    name: string,
    safe: boolean,
    public: boolean,
    returnType: tsm.Type,
    parameters: ReadonlyArray<{ name: string, type: tsm.Type }>,
    variables: ReadonlyArray<{ name: string, type: tsm.Type }>,
    operations: ReadonlyArray<Operation>,
    instructions?: Uint8Array,
}

export interface ProcessMethodOptions {
    diagnostics: tsm.ts.Diagnostic[];
    builder: MethodBuilder,
    scope: ReadonlyScope,
}

// @internal
export function processMethodDef(def: MethodSymbolDef, diagnostics: Array<tsm.ts.Diagnostic>): ContractMethod {

    const node = def.node;
    const name = node.getNameOrThrow();
    const body = node.getBodyOrThrow();
    if (!tsm.Node.isStatement(body)) {
        throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
    }

    const builder = new MethodBuilder(node.getParameters().length);
    processStatement(body, { diagnostics, builder, scope: def });

    return {
        name,
        safe: hasSafeTag(node),
        public: !!node.getExportKeyword(),
        returnType: node.getReturnType(),
        parameters: node.getParameters().map(p => ({ name: p.getName(), type: p.getType(), })),
        variables: builder.getVariables(),
        operations: builder.getOperations()
    }
}

export function processMethodDefinitions(context: CompileContext) {

    for (const scope of context.scopes) {
        for (const def of scope.symbols) {
            if (def instanceof MethodSymbolDef) {
                const method = processMethodDef(def, context.diagnostics);
                context.methods.push(method);
            }
        }
    }
}
