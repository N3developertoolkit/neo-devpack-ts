import { Symbol } from "ts-morph";
import { SymbolDef } from "./symbolDef";
import { pipe } from 'fp-ts/lib/function';
import * as O from 'fp-ts/Option';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as Eq from 'fp-ts/Eq';

export interface Scope {
    readonly parentScope: O.Option<Scope>,
    readonly symbols: ReadonlyMap<Symbol, SymbolDef>
}

const symbolEq: Eq.Eq<Symbol> = { equals: (x, y) => x === y }

export const resolve =
    (scope: Scope) =>
        (symbol: Symbol): O.Option<SymbolDef> => {
            return pipe(
                ROM.lookup(symbolEq)(symbol)(scope.symbols),
                O.alt(() => pipe(
                    symbol.getValueDeclaration()?.getSymbol(),
                    O.fromNullable,
                    O.chain(s => ROM.lookup(symbolEq)(s)(scope.symbols))
                )),
                O.alt(() => pipe(
                    scope.parentScope,
                    O.chain(p => resolve(p)(symbol))
                ))
            );
        }

const createSymbolMap =
    (defs: ReadonlyArray<SymbolDef>) =>
        ROM.fromMap(new Map<Symbol, SymbolDef>(defs.map(v => [v.symbol, v])));

export const createScope = (parentScope?: Scope) =>
    (defs: ReadonlyArray<SymbolDef>): Scope => {
        return {
            parentScope: O.fromNullable(parentScope),
            symbols: createSymbolMap(defs),
        };
    }

export const updateScope = (scope: Scope) =>
    (defs: ReadonlyArray<SymbolDef>): Scope => {
        return {
            parentScope: scope.parentScope,
            symbols: createSymbolMap(ROA.concat(defs)([...scope.symbols.values()])),
        }
    }
