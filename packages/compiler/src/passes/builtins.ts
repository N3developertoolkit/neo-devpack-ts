import * as E from "fp-ts/Either";
import * as tsm from "ts-morph";
import { Scope } from "../scope";
import { CallableSymbolDef, ParseError } from "../symbolDef";
import { Operation, PushDataOperation } from "../types/Operation";
// import { FunctionSymbolDef, ObjectSymbolDef, Scope } from "../scope";
// import { ProcessMethodOptions } from "./processFunctionDeclarations";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as FP from 'fp-ts'
import { pipe } from "fp-ts/lib/function";
import { parseExpression } from "./expressionProcessor";
import { getArguments } from "../utils";

export const makeErrorObj = (symbol: tsm.Symbol): CallableSymbolDef => {
    return {
        symbol,
        parseCall: (node, scope) => {
            return pipe(
                node,
                getArguments,
                ROA.head, 
                O.match(
                    () => E.right([{ kind: 'pushdata', value: Buffer.from("", "utf8") } as Operation]),
                    parseExpression(scope)
                ),
                E.bindTo('args'),
                E.bind('call', () => E.right([]))
            )
        }
    }
}

// export function emitError(args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions): void {
//     // const arg = args[0];
//     // if (arg) { processExpression(arg, options); }
//     // else { options.builder.emitPushData(""); }
// }


// type EmitCallFunction = (options: ProcessMethodOptions) => void;

// // function createFunction(symbol: tsm.Symbol, emitCall: EmitCallFunction, propMap?: ReadonlyMap<string, SymbolDef>): FunctionSymbolDef {
// //     return {
// //         symbol,
// //         getProp: (name) => propMap?.get(name),
// //         emitCall
// //     };
// // }

// // function createObject(symbol: tsm.Symbol, propMap?: ReadonlyMap<string, SymbolDef>): ObjectSymbolDef {
// //     return {
// //         symbol,
// //         getProp: (name) => propMap?.get(name),
// //     };
// // }

// // function defineFunctionObj(scope: Scope | Map<string, SymbolDef>, symbol: tsm.Symbol | undefined, emitCall: EmitCallFunction, propMap?: ReadonlyMap<string, SymbolDef>) {
// //     if (symbol) {
// //         var func: FunctionSymbolDef = {
// //             symbol,
// //             getProp: (name) => propMap?.get(name),
// //             emitCall,
// //         }
// //         if (scope instanceof Map) {
// //             scope.set(symbol.getName(), func);
// //         } else {
// //             scope.define(func);
// //         }
// //     }
// // }

// // function defineObject(scope: Scope | Map<string, SymbolDef>, symbol: tsm.Symbol | undefined, propMap?: ReadonlyMap<string, SymbolDef>) {
// //     if (symbol) {
// //         var obj: ObjectSymbolDef = {
// //             symbol,
// //             getProp: (name) => propMap?.get(name),
// //         }
// //         if (scope instanceof Map) {
// //             scope.set(symbol.getName(), obj);
// //         } else {
// //             scope.define(obj);
// //         }
// //     }
// // }

// export function defineErrorObj(scope: Scope, map: ReadonlyMap<string, tsm.VariableDeclaration>) {
//     const decl = map.get("Error");
//     const symbol = decl?.getSymbol();
//     if (symbol) {
//         const obj: FunctionSymbolDef = {
//             symbol,
//             getProp: () => undefined,
//             parseCall: emitError
//         };
//         scope.define(obj);
//     }
// }

// export function defineUint8ArrayObj(scope: Scope, map: ReadonlyMap<string, tsm.VariableDeclaration>) {
//     const decl = map.get("Uint8Array");
//     const symbol = decl?.getSymbol();
//     if (symbol) {
//         const fromSym = decl?.getType().getProperty("from");

//         if (fromSym) {
//             const fromObj: FunctionSymbolDef = {
//                 symbol: fromSym,
//                 getProp: () => undefined,
//                 parseCall: emitU8ArrayFrom
//             }

//             const obj: ObjectSymbolDef = {
//                 symbol,
//                 getProp: (name: string) => name === 'from'
//                     ? () => fromObj
//                     : undefined
//             }

//             scope.define(obj);
//         }
//     }
// }

// export function emitU8ArrayFrom(args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions): void {

//     // if (!arg) throw new CompileError("Invalid arg count", $this.getParent()!);
//     // processExpression(arg, options);
//     // const { builder } = options;
//     // const array = builder.popArray();
//     // if (array) {
//     //     const buffer = new Array<number>();
//     //     for (const a of array) {
//     //         if (isPushIntOperation(a)) {
//     //             buffer.push(Number(a.value));
//     //         }
//     //     }
//     //     if (buffer.length == array.length) {
//     //         const data = Uint8Array.from(buffer);
//     //         builder.emitPushData(data);
//     //         return;
//     //     }
//     // }
//     throw new Error("not implemented");
// }


