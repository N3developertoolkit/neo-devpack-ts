import * as tsm from "ts-morph";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as TS from "../TS";

import { GlobalScopeContext, getVarDecl, getVarDeclAndSymbol, makeInterface, makeMethod, makeProperties } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetValueFunc, NewInvokeResolver, PropertyResolver } from "../types/CompileTimeObject";
import { ParseError, createDiagnostic, makeParseError, single } from "../utils";
import { Operation, isPushDataOp, isPushIntOp } from "../types/Operation";
import { sc, u } from "@cityofzion/neon-core";

export function makeMap(ctx: GlobalScopeContext) {
    makeMapObject(ctx);
    makeMapInterface(ctx);
}

function invokeMapCtor(node: tsm.NewExpression, args: readonly GetValueFunc[]): E.Either<ParseError, CompileTimeObject> {
    if (ROA.isNonEmpty(args)) return E.left(makeParseError(node)("Map constructor with arguments not implemented"))
    return E.of(<CompileTimeObject>{ node, loadOps: [{ kind: 'newemptymap' }] })
}

function makeMapObject(ctx: GlobalScopeContext) {
    pipe(
        "Map",
        getVarDecl(ctx),
        E.chain(node => {
            return pipe(
                node.getSymbol(),
                E.fromNullable("could not get Map type symbol"),
                E.map(symbol => {
                    const callNew: NewInvokeResolver = (node) => ($this, args) => invokeMapCtor(node, args)
                    return <CompileTimeObject>{ node, symbol, loadOps: [], callNew };
                }),
            );
        }),
        E.match(
            () => ctx.addError(createDiagnostic("could not find Error declaration")),
            ctx.addObject
        )
    );
}

const callClear: CallInvokeResolver = (node) => ($this) => {
    return pipe(
        $this(),
        E.map(cto => cto.loadOps),
        E.map(ROA.append<Operation>({ kind: 'clearitems' })),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

function parseKeyArg(node: tsm.Node, args: readonly GetValueFunc[]) {
    return pipe(
        args, 
        ROA.lookup(0), 
        E.fromOption(() => makeParseError(node)("could not find key argument")),
        E.chain(arg => arg())
    );
}

const callDelete: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.bind("key", () => parseKeyArg(node, args)),
        E.map(({ $this, key }) => {
            const loadOps = pipe(
                $this.loadOps,
                ROA.concat(key.loadOps),
                ROA.append<Operation>({ kind: 'removeitem' })
            )
            return <CompileTimeObject>{ node, loadOps }
        })
    )
}

const callGet: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.bind("key", () => parseKeyArg(node, args)),
        E.map(({ $this, key }) => {
            const loadOps = pipe(
                $this.loadOps,
                ROA.concat(key.loadOps),
                ROA.append<Operation>({ kind: 'pickitem' })
            )
            return <CompileTimeObject>{ node, loadOps }
        })
    )
}

const callHas: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.bind("key", () => parseKeyArg(node, args)),
        E.map(({ $this, key }) => {
            const loadOps = pipe(
                $this.loadOps,
                ROA.concat(key.loadOps),
                ROA.append<Operation>({ kind: 'haskey' })
            )
            return <CompileTimeObject>{ node, loadOps }
        })
    )

}

const callSet: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.bind("key", () => parseKeyArg(node, args)),
        E.bind("value", () => pipe(
            args, 
            ROA.lookup(1), 
            E.fromOption(() => makeParseError(node)("could not find value argument")), 
            E.chain(arg => arg())
        )),
        E.map(({ $this, key, value }) => {
            const loadOps = pipe(
                $this.loadOps,
                ROA.concat(key.loadOps),
                ROA.concat(value.loadOps),
                ROA.append<Operation>({ kind: 'setitem' })
            )
            return <CompileTimeObject>{ node, loadOps }
        })
    );
}

function makeSize(symbol: tsm.Symbol): E.Either<string, PropertyResolver> {
    return pipe(
        symbol,
        TS.getPropSig,
        O.map(node => {
            const resolver: PropertyResolver = ($this) => pipe(
                $this(),
                E.map(ROA.append<Operation>({ kind: "size" })),
                E.map(loadOps => <CompileTimeObject>{ node: node, loadOps })
            );
            return resolver;
        }),
        E.fromOption(() => `could not find ${symbol.getName()} member`)
    )
}

function makeMapInterface(ctx: GlobalScopeContext) {
    const members = {
        size: makeSize,
        clear: makeMethod(callClear),
        delete: makeMethod(callDelete),
        get: makeMethod(callGet),
        has: makeMethod(callHas),
        set: makeMethod(callSet),
    }
    makeInterface("Map", members, ctx);
}
