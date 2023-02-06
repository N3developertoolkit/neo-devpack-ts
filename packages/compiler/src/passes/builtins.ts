// // import { resolve } from "path";
import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef } from "../scope";
// // import { CompileError } from "../compiler";
// // import { ConstantSymbolDef, resolveOrThrow, VariableSymbolDef } from "../scope";
// // import { dispatch } from "../utility/nodeDispatch";
// // import { asExpressionOrCompileError, getConstantValue, getNumericLiteral, getSymbolOrCompileError } from "../utils";
// // import { ProcessOptions } from "./processFunctionDeclarations";
// // import { CompileError } from "./compiler";
// // import { ProcessOptions, processExpression } from "./passes/processOperations";
// // import { StackItemType } from "./types/StackItem";
// // import { asExpressionOrCompileError, asKindOrCompileError, getNumericLiteral, isBigIntLike } from "./utils";

import { MethodBuilder } from "./MethodBuilder";
import { ProcessMethodOptions } from "./processFunctionDeclarations";

// // I need to be able to resolve types and symbols
// // SCFX types have a prefix like : "\"/node_modules/@neo-project/neo-contract-framework/index\".StorageConstructor"
// // native types have no prefix like : Uint8ArrayConstructor

// interface ExternInfo {
//     kind: tsm.SyntaxKind,
//     // func: ProcessFunction
// };

// type ExternMembers = {
//     [key: string]: ExternInfo
// };

// type ExternContainers = {
//     [key: string]: ExternMembers
// };

// const scfx: ExternContainers = {
//     StorageConstructor: {
//         currentContext: {
//             kind: tsm.SyntaxKind.PropertyAccessExpression,
//             func:  (node, options) => { options.builder.pushSysCall("System.Storage.GetContext"); }
//         },
//         get: {
//             kind: tsm.SyntaxKind.CallExpression,
//             func: storageConstructorMethod("System.Storage.Get")
//         },
//         put: {
//             kind: tsm.SyntaxKind.CallExpression,
//             func: storageConstructorMethod("System.Storage.Put")
//         },
//         delete: {
//             kind: tsm.SyntaxKind.CallExpression,
//             func: storageConstructorMethod("System.Storage.Delete")
//         },
//     },
//     // ByteStringConstructor: {
//     //     from: {
//     //         kind: tsm.SyntaxKind.CallExpression,
//     //         func: ByteStringConstructor_from,
//     //     },
//     // },
//     ByteString: {
//         toBigInt: {
//             kind: tsm.SyntaxKind.CallExpression,
//             func: ByteString_toBigInt
//         },
//     }
// }

// const scfxPath = '"/node_modules/@neo-project/neo-contract-framework/index"';

// function resolveExtern(node: tsm.Node): ExternInfo | undefined {
//     if (tsm.Node.isPropertyAccessExpression(node)) {
//         const expr = node.getExpression();
//         const exprType = expr.getType();
//         const exprTypeFQN = exprType.getSymbolOrThrow().getFullyQualifiedName();
//         if (exprTypeFQN.startsWith(`${scfxPath}.`)) {
//             const typeName = exprTypeFQN.substring(scfxPath.length + 1);
//             if (typeName in scfx) {
//                 const obj = scfx[typeName];
//                 const propName = node.getName();
//                 if (propName in obj) {
//                     return obj[propName];
//                 }
//             }
//         }
//     } else if (tsm.Node.isCallExpression(node)) {
//         return resolveExtern(node.getExpression());
//     }

//     return undefined;
// }
// export function resolveBuiltIn2(node: tsm.Node): ProcessFunction | undefined {
//     const extern = resolveExtern(node);
//     if (extern && node.isKind(extern.kind)) {
//         return extern.func;
//     }

//     return undefined;
// }

// function storageConstructorMethod(syscall: NeoService): ProcessFunction {
//     return (node: tsm.Node, options: ProcessOptions) => {
//         const call = asKindOrCompileError(node, tsm.SyntaxKind.CallExpression);
//         processArguments(call.getArguments(), options);
//         options.builder.pushSysCall(syscall);
//     }
// }

// function ByteString_toBigInt(node: tsm.Node, options: ProcessOptions): void {
//     const call = asKindOrCompileError(node, tsm.SyntaxKind.CallExpression);
//     processExpression(call.getExpression(), options);
//     options.builder.pushConvert(StackItemType.Integer);
// }

// class ByteStringBuilder {
//     private readonly buffer = new Array<number>();
//     push(value: number | bigint) {
//         if (typeof value === 'bigint') {
//             value = Number(value);
//         }
//         if (value < 0 || value > 255) throw new Error("Invalid byte value");
//         this.buffer.push(value);
//     }
//     get value() { return Uint8Array.from(this.buffer); }

// }

// function asBytes(node: tsm.Expression) {
//     const arrayLiteral = asKindOrCompileError(node, tsm.SyntaxKind.ArrayLiteralExpression);
//     const builder = new ByteStringBuilder();
//     for (const e of arrayLiteral.getElements()) {
//         if (tsm.Node.isNumericLiteral(e)) {
//             const literal = getNumericLiteral(e);
//             if (literal < 0 || literal >= 256) throw new CompileError("Invalid byte value", e);
//             builder.push(literal);
//         }
//     }
//     return builder.value;
// }

// export function ByteStringConstructor_from(node: tsm.CallExpression, options: ProcessOptions): void {
//     const { builder } = options;

//     const arg = asExpressionOrCompileError(node.getArguments()[0]);
//     if (tsm.Node.isArrayLiteralExpression(arg)) {
//         const buffer = new Array<number>();
//         for (const e of arg.getElements()) {
//             if (tsm.Node.isSpreadElement(e)) {
//                 console.log();
//             } else {
//                 buffer.push(getElementValue(e))
//             }
            
//         }
//         builder.pushData(Uint8Array.from(buffer))
//         return;
//     } 
    
//     if (tsm.Node.isIdentifier(arg)) {
//         const resolved = resolveOrThrow(options.scope, arg);
//         if (resolved instanceof VariableSymbolDef) {
//             builder.pushLoad(resolved.slotType, resolved.index);
//             return;
//         }
//     }
//     throw new CompileError(`not supported`, arg)

//     function getElementValue(node: tsm.Expression) {
//         switch (node.getKind()) {
//             case tsm.SyntaxKind.BigIntLiteral: 
//                 return Number((node as tsm.BigIntLiteral).getLiteralValue() as bigint);
//             case tsm.SyntaxKind.NumericLiteral: 
//                 return getNumericLiteral(node as tsm.NumericLiteral);
//             case tsm.SyntaxKind.Identifier: {
//                 const resolved = resolveOrThrow(options.scope, node);
//                 if (resolved instanceof ConstantSymbolDef) {
//                     const value = resolved.value;
//                     if (typeof value === 'bigint') return Number(value);
//                     if (typeof value === 'boolean') return value ? 1 : 0;
//                     if (value === null) return 0;
//                 }
//             }
//         }

//         throw new CompileError(`not supported`, node);
//     }

// }



export function emitU8ArrayFrom(args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions): void {
    if (args.length === 0) throw new Error("Invalid arg count");
    const arg = args[0];
    const buffer = new Array<number>();
    if (tsm.Node.isArrayLiteralExpression(arg)) {
        for (const elem of arg.getElements()) {
            switch (elem.getKind()) {
                case tsm.SyntaxKind.BigIntLiteral: {
                    const value = (elem as tsm.BigIntLiteral).getLiteralValue() as bigint;
                    buffer.push(Number(value));
                }
                break;
                case tsm.SyntaxKind.NumericLiteral: {
                    const value = (elem as tsm.NumericLiteral).getLiteralValue();
                    buffer.push(value);
                }
                break;
                case tsm.SyntaxKind.Identifier: {
                    const resolved = options.scope.resolve(elem.getSymbol());
                    if (resolved instanceof ConstantSymbolDef
                        && typeof resolved.value === 'bigint'
                    ) {
                        buffer.push(Number(resolved.value));
                    } else {
                        throw new CompileError('unsupported array identifier', elem);
                    }
                }
                break;
                default:
                    throw new CompileError(`Unsupported array literal element type ${elem.getKindName()}`, elem);
            }
        }
    } else {
        throw new CompileError('not implemented', arg);
    }
    const data = Uint8Array.from(buffer);
    options.builder.emitPushData(data);
}