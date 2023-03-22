import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/lib/function';
import * as O from 'fp-ts/Option';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as Eq from 'fp-ts/Eq';
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


function createSymbolMap<T extends { readonly symbol: tsm.Symbol }>(items: readonly T[]) {
    return ROM.fromMap(new Map(items.map(v => [v.symbol, v])))
}

export const createScope = (parentScope?: Scope) =>
    (defs: readonly SymbolDef[], types: readonly TypeDef[] = []): Scope => {
        return {
            parentScope: O.fromNullable(parentScope),
            symbols: createSymbolMap(defs),
            types: createSymbolMap(types),
        };
    }

export const updateScope = (scope: Scope) =>
    (defs: ReadonlyArray<SymbolDef>, types: readonly TypeDef[] = []): Scope => {

        defs = ROA.concat(defs)([...scope.symbols.values()]);
        types = ROA.concat(types)([...scope.types.values()]);

        return {
            parentScope: scope.parentScope,
            symbols: createSymbolMap(defs),
            types: createSymbolMap(types),
        }
    }
