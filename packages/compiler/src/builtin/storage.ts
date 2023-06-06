import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from "../TS";

import { GlobalScopeContext, getVarDeclAndSymbol, makeInterface, makeMethod, makeProperties } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetValueFunc, PropertyResolver, parseArguments } from "../types/CompileTimeObject";
import { Operation, getBooleanConvertOps, isPushBoolOp, makeConditionalExpression, pushInt } from "../types/Operation";
import { createDiagnostic, makeParseError, single } from "../utils";

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
        "Storage",
        getVarDeclAndSymbol(ctx),
        E.bind('properties', ({ node }) => makeProperties<string>(node, storageProps, makeProperty)),
        E.map(({ node, symbol, properties }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties }),
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

function getCompileTimeBoolean(cto: CompileTimeObject): O.Option<boolean> {
    if (tsm.Node.isTrueLiteral(cto.node) || tsm.Node.isFalseLiteral(cto.node)) {
        return O.of(cto.node.getLiteralValue());
    }

    return pipe(
        cto.loadOps,
        ROA.filter(op => op.kind !== 'noop'),
        single,
        O.chain(O.fromPredicate(isPushBoolOp)),
        O.map(op => op.value)
    )
}

const callGet: CallInvokeResolver = makeStorageCall("System.Storage.Get");
const callFind: CallInvokeResolver = makeStorageCall("System.Storage.Find");
const callPut: CallInvokeResolver = makeStorageCall("System.Storage.Put");
const callDelete: CallInvokeResolver = makeStorageCall("System.Storage.Delete");

function makeRemovePrefixFind($true: FindOptions, $false: FindOptions): CallInvokeResolver {

    return (node) => ($this, args) => {
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
                        E.map(cto => {
                            const loadOps = pipe(
                                cto,
                                // if options argument is provided, check to see if it is a compile time boolean  
                                getCompileTimeBoolean,
                                O.match(
                                    // for non compile time booleans, push operations to convert to boolean
                                    // and add a conditional expression to convert the boolean to find options
                                    () => {
                                        const condition = pipe(
                                            cto.loadOps,
                                            ROA.concat(getBooleanConvertOps(cto.node.getType()))
                                        );
                                        const whenTrue = pipe(pushInt($true), ROA.of);
                                        const whenFalse = pipe(pushInt($false), ROA.of);
                                        return makeConditionalExpression({ condition, whenTrue, whenFalse });
                                    },
                                    // for compile time booleans, directly push the appropriate find options
                                    value => [value ? pushInt($true) : pushInt($false)]
                                )
                            );
                            const $cto = <CompileTimeObject>{ ...cto, loadOps };
                            return (() => E.of($cto)) as GetValueFunc;
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
                        getValue => pipe(getValue(), E.map(cto => cto.loadOps))
                    ),
                    E.bindTo('options'),
                    E.bind('args', () => parseArguments([$this, prefix])),
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
        E.chain(arg => parseArguments([$this, arg])),
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
    makeInterface("StorageContext", {
        get: makeMethod(callGet),
        find: makeMethod(callFind),
        entries: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix, FindOptions.None)),
        values: makeMethod(callValues),
        keys: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)),
        asReadonly: makeAsReadonly,
        put: makeMethod(callPut),
        delete: makeMethod(callDelete)
    }, ctx);

    makeInterface("ReadonlyStorageContext", {
        get: makeMethod(callGet),
        find: makeMethod(callFind),
        entries: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix, FindOptions.None)),
        values: makeMethod(callValues),
        keys: makeMethod(makeRemovePrefixFind(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)),
    }, ctx);
}

