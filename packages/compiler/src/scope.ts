import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/lib/function';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as Eq from 'fp-ts/Eq';
import * as STR from 'fp-ts/string';

import { Scope, SymbolDef, TypeDef } from "./types/ScopeType";

const symbolEq: Eq.Eq<tsm.Symbol> = { equals: (x, y) => x === y }

export const resolve =
    (scope: Scope) =>
        (symbol: tsm.Symbol): O.Option<SymbolDef> => {
            return pipe(
                ROM.lookup(symbolEq)(symbol)(scope.symbols),
                // since I'm breaking out types, do I still need this?
                // O.alt(() => pipe(
                //     symbol.getValueDeclaration()?.getSymbol(),
                //     O.fromNullable,
                //     O.chain(s => ROM.lookup(symbolEq)(s)(scope.symbols))
                // )),
                O.alt(() => pipe(
                    scope.parentScope,
                    O.chain(p => resolve(p)(symbol))
                ))
            );
        }

export const resolveType =
    (scope: Scope) =>
        (symbol: tsm.Symbol): O.Option<TypeDef> => {
            return pipe(
                ROM.lookup(symbolEq)(symbol)(scope.types),
                O.alt(() => pipe(
                    scope.parentScope,
                    O.chain(p => resolveType(p)(symbol))
                ))
            );
        }

export const resolveName =
    (scope: Scope) =>
        (name: string): O.Option<SymbolDef> => {
            return pipe(
                [...scope.symbols.entries()],
                ROA.findFirst(e => e[0].getName() === name),
                O.map(t => t[1]),
                O.alt(() => pipe(
                    scope.parentScope,
                    O.chain(p => resolveName(p)(name))
                ))
            );
        }

export const resolveTypeName =
    (scope: Scope) =>
        (name: string): O.Option<TypeDef> => {
            return pipe(
                [...scope.types.entries()],
                ROA.findFirst(e => e[0].getName() === name),
                O.map(t => t[1]),
                O.alt(() => pipe(
                    scope.parentScope,
                    O.chain(p => resolveTypeName(p)(name))
                ))
            );
        }


function isArray<T>(value: T | readonly T[]): value is readonly T[] {
    return Array.isArray(value);
}

function validateDefs<T extends { readonly symbol: tsm.Symbol }>(defs: readonly T[]): E.Either<string, ReadonlyMap<tsm.Symbol, T>> {
    const names = pipe(defs, ROA.map(d => d.symbol.getName()));
    const diff = pipe(names, ROA.difference(STR.Eq)(pipe(names, ROA.uniq(STR.Eq))));
    return diff.length === 0
        ? E.of(ROM.fromMap(new Map(defs.map(v => [v.symbol, v]))))
        : E.left(`validateDefs duplicate names: ${diff.join(', ')}`);
}

export const createEmptyScope = (parentScope?: Scope): Scope => {
    return {
        parentScope: O.fromNullable(parentScope),
        symbols: new Map(),
        types: new Map(),
    }
}

export const createScope = (parentScope?: Scope) =>
    (defs: readonly SymbolDef[], types: readonly TypeDef[] = []): E.Either<string, Scope> => {
        return pipe(
            E.Do,
            E.bind("symbols", () => pipe(defs, validateDefs)),
            E.bind("types", () => pipe(types, validateDefs)),
            E.bind("parentScope", () => E.of(O.fromNullable(parentScope)))
        )
    }


export const updateScopeSymbols =
    (scope: Scope) =>
        (def: SymbolDef | readonly SymbolDef[]): E.Either<string, Scope> => {
            return pipe(
                isArray(def) ? def : ROA.of(def),
                defs => ROA.concat(defs)([...scope.symbols.values()]),
                validateDefs,
                E.map(symbols => ({ ...scope, symbols } as Scope))
            )
        }

export const updateScopeTypes =
    (scope: Scope) =>
        (def: TypeDef | readonly TypeDef[]): E.Either<string, Scope> => {
            return pipe(
                isArray(def) ? def : ROA.of(def),
                defs => ROA.concat(defs)([...scope.types.values()]),
                validateDefs,
                E.map(types => ({ ...scope, types } as Scope))
            )
        }
