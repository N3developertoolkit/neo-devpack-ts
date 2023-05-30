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

import { GlobalScopeContext, getVarDecl, getVarDeclAndSymbol, makeProperties } from "./types";
import { CompileTimeObject } from "../types/CompileTimeObject";
import { Operation } from "../types/Operation";
import { Ord } from "fp-ts/lib/Ord";
import { makePropResolvers } from "../passes/parseDeclarations";
import { createDiagnostic } from "../utils";
import { make } from "fp-ts/lib/Tree";

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
}

function MakeFoosTHing<T>(symbol: tsm.Symbol, value: T, makeCTO: (node: tsm.MethodSignature | tsm.PropertySignature) => CompileTimeObject): E.Either<string, CompileTimeObject> {
    return pipe(
        symbol.getValueDeclaration(),
        O.fromNullable,
        O.chain(O.fromPredicate(TS.isMethodOrProp)),
        E.fromOption(() => `could not find property signature for ${symbol.getName()}`),
        E.map(makeCTO)
    )

}



export function makeStorageObject(ctx: GlobalScopeContext) {

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