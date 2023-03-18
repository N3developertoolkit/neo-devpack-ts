import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord'
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";

import { CallableSymbolDef, ObjectSymbolDef, ParseArgumentsFunc, ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { $SymbolDef, makeParseError } from "../symbolDef";
import { single } from "../utils";
import { isPushBoolOp, isPushDataOp, Operation, PushDataOperation } from "../types/Operation";
import { getArguments, makeConditionalExpression, parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
import { BuiltInCallableOptions, BuiltInSymbolDef, createBuiltInObject, parseBuiltInCallables, parseBuiltInSymbols } from "./builtins.SymbolDefs";
import { concat } from "fp-ts/lib/ReadonlyNonEmptyArray";

const enum FindOptions {
    None = 0,
    KeysOnly = 1 << 0,
    RemovePrefix = 1 << 1,
    ValuesOnly = 1 << 2,
    DeserializeValues = 1 << 3,
    PickField0 = 1 << 4,
    PickField1 = 1 << 5
}

const parsePrefix = (scope: Scope) => (arg: O.Option<tsm.Expression>) => {
    return pipe(
        arg,
        O.match(
            () => E.of(ROA.of({ kind: 'pushdata', value: Uint8Array.from([]) } as Operation)),
            parseExpression(scope)
        ))
}

const parseRemovePrefix =
    (trueOpt: FindOptions, falseOpt: FindOptions) =>
        (scope: Scope) => (arg: O.Option<tsm.Expression>) => {
            return pipe(
                arg,
                O.match(
                    () => E.of(ROA.of({ kind: 'pushbool', value: false } as Operation)),
                    flow(parseExpressionAsBoolean(scope))
                ),
                E.map(condition => {
                    const op = pipe(
                        condition,
                        ROA.filter(op => op.kind != 'noop'),
                        single,
                        O.toUndefined
                    )

                    if (op && isPushBoolOp(op)) {
                        // if the arg is a hard coded true or false, calculate the find option at compile time
                        const option = op.value ? trueOpt : falseOpt;
                        return ROA.of({ kind: 'pushint', value: BigInt(option) } as Operation)
                    } else {
                        // otherwise, insert a conditional to calculate the find option at runtime
                        const whenTrue = ROA.of({ kind: 'pushint', value: BigInt(trueOpt) } as Operation);
                        const whenFalse = ROA.of({ kind: 'pushint', value: BigInt(falseOpt) } as Operation);
                        return makeConditionalExpression({ condition, whenTrue, whenFalse })
                    }
                })
            )
        }

export const invokeFindRemovePrefix =
    (trueOpt: FindOptions, falseOpt: FindOptions) =>
        (scope: Scope) => (
            node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                getArguments,
                args => {
                    return pipe(
                        args,
                        ROA.lookup(0),
                        parsePrefix(scope),
                        E.bindTo('prefix'),
                        E.bind('removePrefix', () => pipe(
                            args,
                            ROA.lookup(1),
                            parseRemovePrefix(trueOpt, falseOpt)(scope))
                        ),
                        E.map(o => ROA.concat(o.prefix)(o.removePrefix))
                    )
                }
            )
        }


export const invokeFindValues =
    (scope: Scope) => (
        node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node,
            getArguments,
            args => {
                return pipe(
                    args,
                    ROA.lookup(0),
                    parsePrefix(scope),
                )
            },
            E.map(prefix => {
                const options = ROA.of({ kind: 'pushint', value: BigInt(FindOptions.ValuesOnly) } as Operation);
                return ROA.concat(prefix)(options);
            })

        )
    }

const readonlyStorageContextMethods: Record<string, BuiltInCallableOptions> = {
    "get": { 
        loadOps: [{ kind: "syscall", name: "System.Storage.Get" } as Operation], 
    },
    "find": { 
        loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation], 
    },
    "entries": {
        loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
        parseArguments: invokeFindRemovePrefix(FindOptions.RemovePrefix, FindOptions.None)
    },
    "keys": {
        loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
        parseArguments: invokeFindRemovePrefix(FindOptions.RemovePrefix | FindOptions.KeysOnly, FindOptions.KeysOnly)
    },
    "values": {
        loadOps: [{ kind: "syscall", name: "System.Storage.Find" } as Operation],
        parseArguments: invokeFindValues
    },
}

const storageContextProperties: Record<string, ReadonlyArray<Operation>> = {
    "asReadonly": [{ kind: "syscall", name: "System.Storage.AsReadOnly" } as Operation],
}

const storageContextMethods: Record<string, BuiltInCallableOptions> = {
    "put": { loadOps: [{ kind: "syscall", name: "System.Storage.Put" } as Operation], },
    "delete": { loadOps: [{ kind: "syscall", name: "System.Storage.Delete" } as Operation], },
}

export function makeReadonlyStorageContext(decl: tsm.InterfaceDeclaration) {
    const props = parseBuiltInCallables(decl)(readonlyStorageContextMethods);
    return createBuiltInObject(decl, { props });
}

export function makeStorageContext(decl: tsm.InterfaceDeclaration) {
    const properties = parseBuiltInSymbols(decl)(storageContextProperties);
    const methods = parseBuiltInCallables(decl)(storageContextMethods);
    const roMethods = parseBuiltInCallables(decl)(readonlyStorageContextMethods);
    const props = pipe(properties, ROA.concat(roMethods), ROA.concat(methods));
    return createBuiltInObject(decl, { props });
}

const storageConstructorProperties: Record<string, ReadonlyArray<Operation>> = {
    "context": [{ kind: "syscall", name: "System.Storage.GetContext" } as Operation],
    "readonlyContext": [{ kind: "syscall", name: "System.Storage.GetReadOnlyContext" } as Operation],
}

export function makeStorageConstructor(decl: tsm.InterfaceDeclaration) {
    const props = parseBuiltInSymbols(decl)(storageConstructorProperties);
    return createBuiltInObject(decl, { props });
}