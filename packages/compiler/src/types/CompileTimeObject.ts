import * as tsm from "ts-morph";

import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as STR from 'fp-ts/string';

import { Operation } from "./Operation";
import { ParseError } from "../utils";

export type ParseArgumentsFunc = (scope: Scope) => (node: tsm.CallExpression) => E.Either<ParseError, readonly Operation[]>;
export type GetPropertyFunc = (symbol: tsm.Symbol) => O.Option<CompileTimeObject>;

export interface CompileTimeObject {
    readonly node: tsm.Node;
    readonly symbol: tsm.Symbol;
    readonly loadOps?: ReadonlyArray<Operation>;
    readonly storeOps?: ReadonlyArray<Operation>;
    readonly getProperty?: GetPropertyFunc;
    readonly parseCall?: ParseArgumentsFunc;
    readonly parseConstructor?: ParseArgumentsFunc;
}

export interface CompileTimeObjectOptions {
    readonly loadOps?: ReadonlyArray<Operation>;
    readonly storeOps?: ReadonlyArray<Operation>;
    readonly getProperty?: GetPropertyFunc | readonly CompileTimeObject[];
    readonly parseCall?: ParseArgumentsFunc;
    readonly parseConstructor?: ParseArgumentsFunc;
}

export function makeCompileTimeObject(node: tsm.Node, symbol: tsm.Symbol, options: CompileTimeObjectOptions): CompileTimeObject {
    return {
        node,
        symbol,
        loadOps: options.loadOps,
        storeOps: options.storeOps,
        getProperty: makeGetProperty(),
        parseCall: options.parseCall,
        parseConstructor: options.parseConstructor,
    };

    function makeGetProperty(): GetPropertyFunc | undefined {
        const getProperty = options.getProperty;
        if (!getProperty) {
            // a callable object also needs to implement getProperty
            // Return a stub getProperty method if getProperty is not provided
            return options.parseCall || options.parseConstructor
                ? (_symbol) => O.none
                : undefined;
        }
        // if getProperty is a function, return it as is
        if (typeof getProperty === 'function') return getProperty;

        // if getProperty is an array of CompileTimeObjects, create a map and
        // return a method that looks up the provided symbol in the map
        const map = new Map(getProperty.map(cto => [cto.symbol, cto] as const));
        return (symbol) => O.fromNullable(map.get(symbol));
    }
}


export interface ObjectSymbolDef extends CompileTimeObject {
    readonly getProperty: GetPropertyFunc;
}



export interface CallableSymbolDef extends ObjectSymbolDef {
    parseCall: ParseArgumentsFunc;
    parseConstructor?: ParseArgumentsFunc;
}

export interface Scope {
    readonly parentScope: O.Option<Scope>;
    readonly symbols: ReadonlyMap<tsm.Symbol, CompileTimeObject>;
    readonly types: ReadonlyMap<tsm.Symbol, CompileTimeObject>;
}

function createSymbolMap(ctos: readonly CompileTimeObject[]): E.Either<string, ReadonlyMap<tsm.Symbol, CompileTimeObject>> {
    const names = pipe(ctos, ROA.map(d => d.symbol.getName()));
    const diff = pipe(names, ROA.difference(STR.Eq)(pipe(names, ROA.uniq(STR.Eq))));
    return diff.length === 0
        ? E.of(new Map(ctos.map(v => [v.symbol, v])) as ReadonlyMap<tsm.Symbol, CompileTimeObject>)
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
const $createScope = (parentScope: O.Option<Scope>) => (defs: readonly CompileTimeObject[], types: readonly CompileTimeObject[] = []): E.Either<string, Scope> => {
    return pipe(
        E.Do,
        E.bind("symbols", () => pipe(defs, createSymbolMap)),
        E.bind("types", () => pipe(types, createSymbolMap)),
        E.bind("parentScope", () => E.of(parentScope))
    );
};


export const createScope = (parentScope?: Scope) => (defs: readonly CompileTimeObject[], types: readonly CompileTimeObject[] = []): E.Either<string, Scope> => {
    return $createScope(O.fromNullable(parentScope))(defs, types);
};

export const updateScope = (scope: Scope) => (symbols?: CompileTimeObject | readonly CompileTimeObject[], types?: CompileTimeObject | readonly CompileTimeObject[]): E.Either<string, Scope> => {
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

export const resolve = (scope: Scope) => (symbol: tsm.Symbol): O.Option<CompileTimeObject> => {
    return pipe(
        scope.symbols.get(symbol),
        O.fromNullable,
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolve(p)(symbol))
        ))
    );
};

export const resolveType = (scope: Scope) => (symbol: tsm.Symbol): O.Option<CompileTimeObject> => {
    return pipe(
        scope.types.get(symbol),
        O.fromNullable,
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolveType(p)(symbol))
        ))
    );
};

export const resolveName = (scope: Scope) => (name: string): O.Option<CompileTimeObject> => {
    return pipe(
        scope.symbols,
        findFirst(name),
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolveName(p)(name))
        ))
    );
};

export const resolveTypeName = (scope: Scope) => (name: string): O.Option<CompileTimeObject> => {
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
    return (map: ReadonlyMap<tsm.Symbol, CompileTimeObject>): O.Option<CompileTimeObject> => {
        for (const [key, value] of map.entries()) {
            if (key.getName() === name) {
                return O.some(value);
            }
        }
        return O.none;
    };
}
