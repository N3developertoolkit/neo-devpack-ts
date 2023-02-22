import { create } from "domain";
import * as tsm from "ts-morph";
import { SymbolDef } from "./symbolDef";

import { flow, pipe } from 'fp-ts/lib/function';

import * as O from 'fp-ts/Option'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as FP from 'fp-ts'

// import { CompileContext, CompileError } from "./compiler";
// import { dispatch, NodeDispatchMap } from "./utility/nodeDispatch";
// import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
// import { createDiagnostic, getConstantValue, getJSDocTag, isVoidLike } from "./utils";
// import { from } from 'ix/iterable';
// import { map, orderBy } from 'ix/iterable/operators';
// import { ProcessMethodOptions } from './passes/processFunctionDeclarations';
// import { sc, u } from '@cityofzion/neon-core';
// import { CallOperation, CallTokenOperation, LoadStoreOperation, Operation, parseOperation, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation } from './types/Operation';
// import { ok as parseOK, error as parseError, ParseExpressionResult, parseCallArguments, parseArguments, DiagnosticResult } from './passes/expressionProcessor';
// import * as ROA from 'fp-ts/ReadonlyArray';
// import * as E from "fp-ts/Either";
// import * as M from "fp-ts/Monoid";
// import * as O from 'fp-ts/Option'



export interface Scope {
    readonly parentScope: O.Option<Scope>,
    readonly symbols: ReadonlyMap<tsm.Symbol, SymbolDef>
}

const eqsymbol: FP.eq.Eq<tsm.Symbol> = { equals: (x, y) => x === y, }

export const resolve = (scope: Scope) => (symbol: tsm.Symbol): O.Option<SymbolDef> => {
    return pipe(
        ROM.lookup(eqsymbol)(symbol)(scope.symbols),
        O.alt(() => pipe(
            symbol.getValueDeclaration()?.getSymbol(),
            O.fromNullable,
            O.chain(s => ROM.lookup(eqsymbol)(s)(scope.symbols))
        )),
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolve(p)(symbol))
        ))
    );
}


export const $createScope = (parentScope?: Scope) => createScope(O.fromNullable(parentScope));

export const createScope = (parentScope: O.Option<Scope>) =>
    (defs: ReadonlyArray<SymbolDef>): Scope => ({
        parentScope,
        symbols: new Map<tsm.Symbol, SymbolDef>(defs.map(v => [v.symbol, v]))
    })

export const updateScope = (scope: Scope) =>
    (defs: ReadonlyArray<SymbolDef>): Scope =>
        createScope(scope.parentScope)(defs.concat([...scope.symbols.values()]));

// export interface ReadonlyScope {
//     readonly parentScope: ReadonlyScope | undefined;
//     readonly symbols: IterableIterator<SymbolDef>;
//     resolve(symbol?: tsm.Symbol): SymbolDef | undefined;
// }

// export interface Scope extends ReadonlyScope {
//     define(def: SymbolDef): void;
// }

// export function isWritableScope(scope: ReadonlyScope): scope is Scope {
//     return 'define' in scope && typeof scope.define === 'function';
// }



// const $resolve = (parent?: ReadonlyScope) => (map: ReadonlyMap<tsm.Symbol, SymbolDef>) => (symbol?: tsm.Symbol) => {
//     if (!symbol) { return undefined; }
//     else {
//         const def = map.get(symbol);
//         if (def) return def;

//         const valDeclSymbol = symbol.getValueDeclaration()?.getSymbol();
//         const valDeclDef = valDeclSymbol
//             ? map.get(valDeclSymbol)
//             : undefined
//         return valDeclDef ?? parent?.resolve();
//     }
// }

// const $define = (map: Map<tsm.Symbol, SymbolDef>) => (def: SymbolDef) => {
//     if (map.has(def.symbol)) {
//         throw new Error(`${def.symbol.getName()} already defined in this scope`);
//     }
//     map.set(def.symbol, def);
// }


// export const createScope = (parentScope?: ReadonlyScope) =>
//     (defs?: ReadonlyArray<SymbolDef>): Scope => {
//         const map = new Map<tsm.Symbol, SymbolDef>((defs ?? []).map(v => [v.symbol, v]));
//         return {
//             parentScope,
//             symbols: map.values(),
//             resolve: $resolve(parentScope)(map),
//             define: $define(map),
//         }
//     }

// export const createReadonlyScope = (parentScope?: ReadonlyScope) =>
//     (defs: ReadonlyArray<SymbolDef>): ReadonlyScope => {
//         const map = new Map<tsm.Symbol, SymbolDef>(defs.map(v => [v.symbol, v]));
//         return {
//             parentScope,
//             symbols: map.values(),
//             resolve: $resolve(parentScope)(map),
//         }
//     }

// export const createGlobalScope = createReadonlyScope();
