import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as TS from "../TS";
import * as ORD from 'fp-ts/Ord';
import * as STR from 'fp-ts/string';

import { GlobalScopeContext, getVarDecl, getVarDeclAndSymbol, makeInterface, makeMethod, makeProperties, parseArguments } from "./types";
import { CallInvokeResolver, CompileTimeObject, GetValueFunc, PropertyResolver } from "../types/CompileTimeObject";
import { Operation, pushInt } from "../types/Operation";
import { Ord } from "fp-ts/lib/Ord";
import { makeMembers, makePropResolvers } from "../passes/parseDeclarations";
import { createDiagnostic, makeParseError } from "../utils";

export const enum FindOptions {
    None = 0,
    KeysOnly = 1 << 0,
    RemovePrefix = 1 << 1,
    ValuesOnly = 1 << 2,
    DeserializeValues = 1 << 3,
    PickField0 = 1 << 4,
    PickField1 = 1 << 5
}

export function makeStorage(ctx: GlobalScopeContext) {
    makeStorageObject(ctx);
    makeStorageContext(ctx);
}

function makeStorageObject(ctx: GlobalScopeContext) {

    const storageProps: Record<string, string> = {
        context: "System.Storage.GetContext",
        readonlyContext: "System.Storage.GetReadOnlyContext"
    }

    return pipe(
        // TODO: $torage => Storage
        "$torage",
        getVarDeclAndSymbol(ctx),
        E.bind('props', ({ node }) => makeProperties<string>(node, storageProps, makeProperty)),
        E.map(({ node, symbol, props }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties: makePropResolvers(props) }),
        E.match(
            error => { ctx.addError(createDiagnostic(error)) },
            ctx.addObject
        )
    )

    function makeProperty(syscall: string) {
        return (symbol: tsm.Symbol): E.Either<string, CompileTimeObject> => {
            return pipe(
                symbol.getValueDeclaration(),
                O.fromNullable,
                O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
                E.fromOption(() => `could not find property signature for ${symbol.getName()}`),
                E.map(node => {
                    const op = <Operation>{ kind: 'syscall', name: syscall }
                    return <CompileTimeObject>{ node, symbol, loadOps: [op] };
                })
            )
        }
    }
}

function makeStorageCall(syscall: string): CallInvokeResolver {
    return (node) => ($this, args) => {
        return pipe(
            args,
            ROA.prepend($this),
            parseArguments,
            E.map(ROA.append<Operation>({ kind: "syscall", name: syscall })),
            E.map(loadOps => <CompileTimeObject>{ node, loadOps })
        )
    };
}
const callGet: CallInvokeResolver = makeStorageCall("System.Storage.Get");
const callFind: CallInvokeResolver = makeStorageCall("System.Storage.Find");
const callPut: CallInvokeResolver = makeStorageCall("System.Storage.Put");
const callDelete: CallInvokeResolver = makeStorageCall("System.Storage.Delete");


// find(prefix: ByteString, options: FindOptions): Iterator<unknown>;

// // with and without RemovePrefix. Default to removing the prefix
// entries(prefix?: ByteString, keepPrefix?: boolean): Iterator<[ByteString, ByteString]>;

const callEntries: CallInvokeResolver = (node) => ($this, args) => {
    return E.left(makeParseError(node)("callEntries not implemented"));
}

// // KeysOnly with and without RemovePrefix, Default to removing the prefix
// keys(prefix?: ByteString, keepPrefix?: boolean): Iterator<ByteString>;

function makeRemovePrefixFind($true: FindOptions, $false: FindOptions): CallInvokeResolver {
    // return (arg: GetValueFunc): GetValueFunc => {

    // }

    throw new Error();
}
// const callKeys: CallInvokeResolver = (node) => ($this, args) => {
//     return pipe(
//         E.Do,
//         E.bind('prefix', () => pipe(
//             args, 
//             ROA.lookup(0), 
//             E.fromOption(() => makeParseError(node)("invalid prefix"))
//         )),
//         E.bind('options', () => pipe(
//             args, 
//             ROA.lookup(0), 
//             E.fromOption(() => makeParseError(node)("invalid keepPrefix")),
//             E.map(convertRemovePrefixArg(FindOptions.RemovePrefix, FindOptions.None))
//         )),
//         E.chain(({ prefix, options }) => parseArguments([$this, prefix, options])),
//         E.map(ROA.append<Operation>({ kind: "syscall", name: "System.Storage.Find" })),
//         E.map(loadOps => <CompileTimeObject>{ node, loadOps })
//     )
// }

const callValues: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        args,
        ROA.head,
        E.fromOption(() => makeParseError(node)("callValues: expected 1 argument")),
        E.chain(arg => parseArguments([$this, arg])),
        E.map(ROA.prepend<Operation>(pushInt(FindOptions.ValuesOnly))),
        E.map(ROA.append<Operation>({ kind: "syscall", name: "System.Storage.Find" })),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

function makeAsReadonly(symbol: tsm.Symbol): E.Either<string, PropertyResolver> {
    return E.left("not implemented")
}

function makeStorageContext(ctx: GlobalScopeContext) {
    // makeInterface("StorageContext", {
    //     get: makeMethod(callGet),
    //     // find: makeFind,
    //     // entries: makeEntries,
    //     // values: makeValues,
    //     // keys: makeKeys,
    //     // asReadonly: makeAsReadonly,
    //     // put: makePut,
    //     // delete: makeDelete
    // }, ctx);

    makeInterface("ReadonlyStorageContext", {
        get: makeMethod(callGet),
        find: makeMethod(callFind),
        entries: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix, FindOptions.None)),
        values: makeMethod(callValues),
        keys: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)),
    }, ctx);
}
