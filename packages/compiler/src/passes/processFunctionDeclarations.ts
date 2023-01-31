import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { MethodSymbolDef, ReadonlyScope } from "../scope";
import { Operation } from "../types/Operation";
import { MethodBuilder } from "./MethodBuilder";
import { processStatement } from "./statementProcessor"


export interface ProcessOptions {
    builder: MethodBuilder,
    scope: ReadonlyScope,
}




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

function isSafe(node: tsm.JSDocableNode): boolean {
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            const { tagName, text } = tag.getStructure();
            if (tagName === "safe" && !text) {
                return true;
            }
        }
    }
    return false;
}

// @internal
export function processFunctionDeclaration(def: MethodSymbolDef) {

    const { node } = def;

    const name = node.getNameOrThrow();
    const body = node.getBodyOrThrow();
    if (!tsm.Node.isStatement(body)) {
        throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
    }

    const builder = new MethodBuilder(node.getParameters().length);
    const options = { builder, scope: def }
    processStatement(body, options);

    const parameters = node.getParameters().map((p, index) => ({
        name: p.getName(),
        type: p.getType(),
        index,
        node: p,
    }));

    return {
        name,
        safe: isSafe(node),
        public: !!node.getExportKeyword(),
        return: node.getReturnType(),
        parameters
    }

}

// export function processFunctionDeclarationsPass(context: CompileContext): void {
//     const { project } = context;

//     for (const src of project.getSourceFiles()) {
//         if (src.isDeclarationFile()) continue;
//         src.forEachChild(node => {
//             if (tsm.Node.isFunctionDeclaration(node)) {
//                 // const symbolDef = resolveOrThrow(globals, node) as FunctionSymbolDef;
//                 // processFunctionDeclaration(symbolDef, context);
//             }
//         });
//     }
// }

// // export function getOperationInfo(node: tsm.FunctionDeclaration) {
// //     return {
// //         name: node.getNameOrThrow(),
// //         safe: node.getJsDocs()
// //             .flatMap(d => d.getTags())
// //             .findIndex(t => t.getTagName() === 'safe') >= 0,
// //         isPublic: !!node.getExportKeyword(),
// //         returnType: node.getReturnType(),
// //         parameters: node.getParameters().map((p, index) => ({
// //             node: p,
// //             name: p.getName(),
// //             type: p.getType(),
// //             index
// //         }))
// //     }
// // }

