import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from "../TS";

import { GlobalScopeContext, makeInterface, makeMethod, makeObject, makeStaticProperty } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetOpsFunc, PropertyResolver, parseArguments } from "../types/CompileTimeObject";
import { Operation, getBooleanConvertOps, isPushBoolOp, makeConditionalExpression, pushInt } from "../types/Operation";
import { ParseError, makeParseError, single } from "../utils";

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

    const members ={
        context: makeStaticProperty([{ kind: 'syscall', name: "System.Storage.GetContext"}]),
        readonlyContext: makeStaticProperty([{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext"}]),
    }

    makeObject(ctx, "Storage", members);
}

function makeStorageCall(syscall: string): CallInvokeResolver {
    return (node) => ($this, args) => {
        return pipe(
            args,
            ROA.prepend($this),
            parseArguments(),
            E.map(ROA.append<Operation>({ kind: "syscall", name: syscall })),
            E.map(loadOps => <CompileTimeObject>{ node, loadOps })
        )
    };
}

function getCompileTimeBoolean(ops: readonly Operation[]): O.Option<boolean> {
    return pipe(
        ops,
        ROA.filter(op => op.kind !== 'noop'),
        single,
        O.chain(O.fromPredicate(isPushBoolOp)),
        O.map(op => op.value)
    )
}

function makeRemovePrefixFind($true: FindOptions, $false: FindOptions): CallInvokeResolver {

    return (node) => ($this, args) => {

        const q = pipe(
            E.Do,
            // take the prefix argument as is
            E.bind('prefix', () => pipe(
                args,
                ROA.lookup(0),
                E.fromOption(() => makeParseError(node)("invalid prefix")),
            )),
            E.bind('options', () => pipe(
                args,
                ROA.lookup(1),
                O.match(
                    () => E.of<ParseError, O.Option<GetOpsFunc>>(O.none),
                    keepPrefix => {


                        return E.of(O.none);
                    }
                        
                ),
                // E.fromOption(() => makeParseError(node)("invalid prefix"))
            )),
        );



        return pipe(
            E.Do,
            // take the prefix argument as is
            E.bind('prefix', () => pipe(
                args,
                ROA.lookup(0),
                E.fromOption(() => makeParseError(node)("invalid prefix"))
            )),
            E.bind('options', () => pipe(
                args,
                ROA.lookup(1),
                O.match(
                    // if options argument is not provided, return none. 
                    // the next step in the pipe will convert the none to a false find options
                    () => E.of(O.none),
                    keepPrefix => pipe(
                        keepPrefix(),
                        E.map(ops => {
                            const loadOps = pipe(
                                ops,
                                // if options argument is provided, check to see if it is a compile time boolean  
                                getCompileTimeBoolean,
                                O.match(
                                    // for non compile time booleans, push operations to convert to boolean
                                    // and add a conditional expression to convert the boolean to find options
                                    () => {
                                        const condition = pipe(
                                            ops,
                                            ROA.concat(getBooleanConvertOps(node.getType()))
                                        );
                                        const whenTrue = pipe(pushInt($true), ROA.of);
                                        const whenFalse = pipe(pushInt($false), ROA.of);
                                        return makeConditionalExpression({ condition, whenTrue, whenFalse });
                                    },
                                    // for compile time booleans, directly push the appropriate find options
                                    value => [value ? pushInt($true) : pushInt($false)]
                                )
                            );
                            return (() => E.of(loadOps)) as GetOpsFunc;
                        }),
                        E.map(O.of)
                    )
                )
            )),
            E.chain(({ prefix, options }) => {
                return pipe(
                    options,
                    O.match(
                        () => E.of(ROA.of<Operation>(pushInt($false))),
                        getValue => getValue(),
                    ),
                    E.bindTo('options'),
                    // System.Storage.Find take 2 arguments
                    E.bind('args', () => parseArguments()([$this, prefix])),
                    E.map(({ options, args }) => ROA.concat(args)(options))
                )
            }),
            E.map(ROA.append<Operation>({ kind: "syscall", name: "System.Storage.Find" })),
            E.map(loadOps => <CompileTimeObject>{ node, loadOps })
        );
    }
}

const callValues: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        args,
        ROA.head,
        E.fromOption(() => makeParseError(node)("callValues: expected 1 argument")),
        E.chain(arg => parseArguments()([$this, arg])),
        E.map(ROA.prepend<Operation>(pushInt(FindOptions.ValuesOnly))),
        E.map(ROA.append<Operation>({ kind: "syscall", name: "System.Storage.Find" })),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

function makeAsReadonly(symbol: tsm.Symbol): E.Either<string, PropertyResolver> {
    return pipe(
        symbol,
        TS.getPropSig,
        O.map(node => {
            const resolver: PropertyResolver = ($this) => {
                return pipe(
                    $this(),
                    E.map(ROA.append<Operation>({kind: "syscall", name: "System.Storage.AsReadOnly"})),
                    E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                );
            }
            return resolver;
        }),
        E.fromOption(() => `could not find ${symbol.getName()} member`)
    );
}

function makeStorageContext(ctx: GlobalScopeContext) {

    const callGet: CallInvokeResolver = makeStorageCall("System.Storage.Get");
    const callFind: CallInvokeResolver = makeStorageCall("System.Storage.Find");
    const callPut: CallInvokeResolver = makeStorageCall("System.Storage.Put");
    const callDelete: CallInvokeResolver = makeStorageCall("System.Storage.Delete");

    makeInterface(ctx, "StorageContext", {
        get: makeMethod(callGet),
        find: makeMethod(callFind),
        entries: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix, FindOptions.None)),
        values: makeMethod(callValues),
        keys: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)),
        asReadonly: makeAsReadonly,
        put: makeMethod(callPut),
        delete: makeMethod(callDelete)
    });

    makeInterface(ctx, "ReadonlyStorageContext", {
        get: makeMethod(callGet),
        find: makeMethod(callFind),
        entries: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix, FindOptions.None)),
        values: makeMethod(callValues),
        keys: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)),
    });
}

