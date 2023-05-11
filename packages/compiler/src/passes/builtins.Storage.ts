import * as tsm from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import * as ROR from 'fp-ts/ReadonlyRecord';
import { Ord as StringOrd } from 'fp-ts/string';
import { Operation } from "../types/Operation";
import { makeCompileTimeObject } from "../types/CompileTimeObject";
import { CompileError } from "../utils";

// import { ParseError, single } from "../utils";
// import { isPushBoolOp, Operation } from "../types/Operation";
// import { makeConditionalExpression, parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
// import { BuiltInCallableOptions, createBuiltInObject, parseBuiltInCallables, parseBuiltInSymbols } from "./builtins.SymbolDefs";
// import { Scope } from "../types/CompileTimeObject";

// export interface StorageConstructor {
//     readonly context: StorageContext;
//     readonly readonlyContext: ReadonlyStorageContext;
// }

// export interface ReadonlyStorageContext {
//     get(key: StorageType): ByteString | undefined;
//     find(prefix: ByteString, options: FindOptions): Iterator<unknown>;
//     entries(prefix?: ByteString, removePrefix?: boolean): Iterator<[ByteString, ByteString]>;
//     keys(prefix?: ByteString, removePrefix?: boolean): Iterator<ByteString>;
//     values(prefix?: ByteString): Iterator<ByteString>;
// }        

// export interface StorageContext extends ReadonlyStorageContext {
//     readonly asReadonly: ReadonlyStorageContext;
//     put(key: StorageType, value: StorageType): void;
//     delete(key: StorageType): void;
// }

// const enum FindOptions {
//     None = 0,
//     KeysOnly = 1 << 0,
//     RemovePrefix = 1 << 1,
//     ValuesOnly = 1 << 2,
//     DeserializeValues = 1 << 3,
//     PickField0 = 1 << 4,
//     PickField1 = 1 << 5
// }

// const parsePrefix = (scope: Scope) => (arg: O.Option<tsm.Expression>) => {
//     return pipe(
//         arg,
//         O.match(
//             () => E.of(ROA.of({ kind: 'pushdata', value: Uint8Array.from([]) } as Operation)),
//             parseExpression(scope)
//         ))
// }

// const parseRemovePrefix =
//     (trueOptions: FindOptions, falseOptions: FindOptions) =>
//         (scope: Scope) => (arg: O.Option<tsm.Expression>) => {
//             return pipe(
//                 arg,
//                 O.match(
//                     () => E.of(ROA.of({ kind: 'pushbool', value: false } as Operation)),
//                     flow(parseExpressionAsBoolean(scope))
//                 ),
//                 E.map(condition => {
//                     const op = pipe(
//                         condition,
//                         ROA.filter(op => op.kind != 'noop'),
//                         single,
//                         O.toUndefined
//                     )

//                     if (op && isPushBoolOp(op)) {
//                         // if the arg is a hard coded true or false, calculate the find option at compile time
//                         const option = op.value ? trueOptions : falseOptions;
//                         return ROA.of({ kind: 'pushint', value: BigInt(option) } as Operation)
//                     } else {
//                         // otherwise, insert a conditional to calculate the find option at runtime
//                         const whenTrue = ROA.of({ kind: 'pushint', value: BigInt(trueOptions) } as Operation);
//                         const whenFalse = ROA.of({ kind: 'pushint', value: BigInt(falseOptions) } as Operation);
//                         return makeConditionalExpression({ condition, whenTrue, whenFalse })
//                     }
//                 })
//             )
//         }

// export const invokeFindRemovePrefix =
//     (trueOptions: FindOptions, falseOptions: FindOptions) =>
//         (scope: Scope) => (
//             node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
//             return pipe(
//                 node,
//                 TS.getArguments,
//                 args => {
//                     return pipe(
//                         args,
//                         ROA.lookup(0),
//                         parsePrefix(scope),
//                         E.bindTo('prefix'),
//                         E.bind('removePrefix', () => pipe(
//                             args,
//                             ROA.lookup(1),
//                             parseRemovePrefix(trueOptions, falseOptions)(scope))
//                         ),
//                         E.map(o => ROA.concat(o.prefix)(o.removePrefix))
//                     )
//                 }
//             )
//         }


// export const invokeFindValues =
//     (scope: Scope) => (
//         node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
//         return pipe(
//             node,
//             TS.getArguments,
//             args => {
//                 return pipe(
//                     args,
//                     ROA.lookup(0),
//                     parsePrefix(scope),
//                 )
//             },
//             E.map(prefix => {
//                 const options = ROA.of({ kind: 'pushint', value: BigInt(FindOptions.ValuesOnly) } as Operation);
//                 return ROA.concat(prefix)(options);
//             })

//         )
//     }

// const readonlyStorageContextMethods: Record<string, BuiltInCallableOptions> = {
//     "get": { 
//         loadOps: [{ kind: "syscall", name: "System.Storage.Get" } as Operation], 
//     },
//     "find": { 
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation], 
//     },
//     "entries": {
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
//         parseArguments: invokeFindRemovePrefix(FindOptions.RemovePrefix, FindOptions.None)
//     },
//     "keys": {
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
//         parseArguments: invokeFindRemovePrefix(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)
//     },
//     "values": {
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
//         parseArguments: invokeFindValues
//     },
// }

// const storageContextProperties: Record<string, ReadonlyArray<Operation>> = {
//     "asReadonly": [{ kind: "syscall", name: "System.Storage.AsReadOnly" } as Operation],
// }

// const storageContextMethods: Record<string, BuiltInCallableOptions> = {
//     "put": { loadOps: [{ kind: "syscall", name: "System.Storage.Put" } as Operation], },
//     "delete": { loadOps: [{ kind: "syscall", name: "System.Storage.Delete" } as Operation], },
// }

// export function makeReadonlyStorageContext(decl: tsm.InterfaceDeclaration) {
//     const props = parseBuiltInCallables(decl)(readonlyStorageContextMethods);
//     return createBuiltInObject(decl, { props });
// }

// export function makeStorageContext(decl: tsm.InterfaceDeclaration) {
//     const properties = parseBuiltInSymbols(decl)(storageContextProperties);
//     const methods = parseBuiltInCallables(decl)(storageContextMethods);
//     const roMethods = parseBuiltInCallables(decl)(readonlyStorageContextMethods);
//     const props = pipe(properties, ROA.concat(roMethods), ROA.concat(methods));
//     return createBuiltInObject(decl, { props });
// }

// const storageConstructorProperties: Record<string, ReadonlyArray<Operation>> = {
//     "context": [{ kind: "syscall", name: "System.Storage.GetContext" } as Operation],
//     "readonlyContext": [{ kind: "syscall", name: "System.Storage.GetReadOnlyContext" } as Operation],
// }

export function makeStorageConstructor(decl: tsm.InterfaceDeclaration) {

    const members: ROR.ReadonlyRecord<string, Operation> = {
        "context": { kind: "syscall", name: "System.Storage.GetContext" },
        "readonlyContext": { kind: "syscall", name: "System.Storage.GetReadOnlyContext" },
    }

    const { left: errors, right: props} = pipe(
        members,
        ROR.collect(StringOrd)((key, value) => pipe(
            decl,
            TS.getMember(key),
            O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
            O.map(sig => makeCompileTimeObject(sig, sig.getSymbolOrThrow(), { loadOps: [value] })),
            E.fromOption(() => key)
        )),
        ROA.separate
    );
    if (errors.length > 0) throw new CompileError(`unresolved ByteStringConstructor members: ${errors.join(', ')}`, decl);
    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError(`no symbol for ${decl.getName()}`, decl);

    return makeCompileTimeObject(decl, symbol, { loadOps: [], getProperty: props})
}

export function makeReadonlyStorageContext(decl: tsm.InterfaceDeclaration) {

}

// export interface ReadonlyStorageContext {
//     get(key: StorageType): ByteString | undefined;
//     find(prefix: ByteString, options: FindOptions): Iterator<unknown>;
//     entries(prefix?: ByteString, removePrefix?: boolean): Iterator<[ByteString, ByteString]>;
//     keys(prefix?: ByteString, removePrefix?: boolean): Iterator<ByteString>;
//     values(prefix?: ByteString): Iterator<ByteString>;
// }        
    
// export interface StorageContext extends ReadonlyStorageContext {
//     readonly asReadonly: ReadonlyStorageContext;
//     put(key: StorageType, value: StorageType): void;
//     delete(key: StorageType): void;
// }

// const readonlyStorageContextMethods: Record<string, BuiltInCallableOptions> = {
//     "get": { 
//         loadOps: [{ kind: "syscall", name: "System.Storage.Get" } as Operation], 
//     },
//     "find": { 
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation], 
//     },
//     "entries": {
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
//         parseArguments: invokeFindRemovePrefix(FindOptions.RemovePrefix, FindOptions.None)
//     },
//     "keys": {
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
//         parseArguments: invokeFindRemovePrefix(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)
//     },
//     "values": {
//         loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
//         parseArguments: invokeFindValues
//     },
// }
