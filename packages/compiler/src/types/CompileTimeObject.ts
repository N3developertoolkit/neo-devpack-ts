import * as tsm from "ts-morph";

import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as STR from 'fp-ts/string';

import { Operation } from "./Operation";
import { ParseError } from "../utils";

export type ParseStoreFunc = (loadOps: readonly Operation[], valueOps: readonly Operation[]) => E.Either<ParseError, readonly Operation[]>;

export interface CompileTimeObject {
    readonly symbol: tsm.Symbol;
    readonly type: tsm.Type;
    readonly loadOps?: ReadonlyArray<Operation>;
    readonly parseStore?: ParseStoreFunc
}

export interface TypeDef {
    readonly symbol: tsm.Symbol;
}

export interface ObjectSymbolDef extends CompileTimeObject {
    readonly props: ReadonlyArray<CompileTimeObject>;
}


export type ParseArgumentsFunc = (scope: Scope) => (node: tsm.CallExpression) => E.Either<ParseError, ReadonlyArray<Operation>>;

export interface CallableSymbolDef extends ObjectSymbolDef {
    parseArguments: ParseArgumentsFunc;
}

export type SymboledCTO = CompileTimeObject & { readonly symbol: tsm.Symbol }

export interface Scope {
    readonly parentScope: O.Option<Scope>;
    readonly symbols: ReadonlyMap<tsm.Symbol, SymboledCTO>;
    readonly types: ReadonlyMap<tsm.Symbol, SymboledCTO>;
}

function createSymbolMap(ctos: readonly SymboledCTO[]): E.Either<string, ReadonlyMap<tsm.Symbol, SymboledCTO>> {
    const names = pipe(ctos, ROA.map(d => d.symbol.getName()));
    const diff = pipe(names, ROA.difference(STR.Eq)(pipe(names, ROA.uniq(STR.Eq))));
    return diff.length === 0
        ? E.of(new Map(ctos.map(v => [v.symbol, v])) as ReadonlyMap<tsm.Symbol, SymboledCTO>)
        : E.left(`validateDefs duplicate names: ${diff.join(', ')}`);
}
function isArray<T>(value: T | readonly T[]): value is readonly T[] {
    return Array.isArray(value);
}

export const createEmptyScope = (parentScope?: Scope): Scope => {
    return {
        parentScope: O.fromNullable(parentScope),
        symbols: new Map(),
        types: new Map(),
    };
};
const $createScope = (parentScope: O.Option<Scope>) => (defs: readonly SymboledCTO[], types: readonly SymboledCTO[] = []): E.Either<string, Scope> => {
    return pipe(
        E.Do,
        E.bind("symbols", () => pipe(defs, createSymbolMap)),
        E.bind("types", () => pipe(types, createSymbolMap)),
        E.bind("parentScope", () => E.of(parentScope))
    );
};


export const createScope = (parentScope?: Scope) => (defs: readonly SymboledCTO[], types: readonly SymboledCTO[] = []): E.Either<string, Scope> => {
    return $createScope(O.fromNullable(parentScope))(defs, types);
};

export const updateScope = (scope: Scope) => (symbols?: SymboledCTO | readonly SymboledCTO[], types?: SymboledCTO | readonly SymboledCTO[]): E.Either<string, Scope> => {
    symbols = symbols
        ? isArray(symbols)
            ? ROA.concat(symbols)([...scope.symbols.values()])
            : ROA.append(symbols)([...scope.symbols.values()])
        : ROA.empty;
    types = types
        ? isArray(types)
            ? ROA.concat(types)([...scope.types.values()])
            : ROA.append(types ?? [])([...scope.types.values()])
        : ROA.empty;
    return $createScope(scope.parentScope)(symbols, types);
};

export const resolve = (scope: Scope) => (symbol: tsm.Symbol): O.Option<SymboledCTO> => {
    return pipe(
        scope.symbols.get(symbol),
        O.fromNullable,
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolve(p)(symbol))
        ))
    );
};

export const resolveType = (scope: Scope) => (symbol: tsm.Symbol): O.Option<SymboledCTO> => {
    return pipe(
        scope.types.get(symbol),
        O.fromNullable,
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolveType(p)(symbol))
        ))
    );
};

export const resolveName = (scope: Scope) => (name: string): O.Option<SymboledCTO> => {
    return pipe(
        scope.symbols,
        findFirst(name),
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolveName(p)(name))
        ))
    );
};

export const resolveTypeName = (scope: Scope) => (name: string): O.Option<SymboledCTO> => {
    return pipe(
        scope.types,
        findFirst(name),
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolveTypeName(p)(name))
        ))
    );
};
function findFirst(name: string) {
    return (map: ReadonlyMap<tsm.Symbol, SymboledCTO>): O.Option<SymboledCTO> => {
        for (const [key, value] of map.entries()) {
            if (key.getName() === name) {
                return O.some(value);
            }
        }
        return O.none;
    };
}

