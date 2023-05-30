import * as tsm from "ts-morph";

import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as STR from 'fp-ts/string';

import { Operation } from "./Operation";
import { CompileError, ParseError, isArray } from "../utils";

export type GetOpsFunc = () => E.Either<ParseError, readonly Operation[]>;
export type GetValueFunc = () => E.Either<ParseError, CompileTimeValue>;

export type PropertyResolver = ($this: GetOpsFunc) => E.Either<ParseError, CompileTimeObject>;
export type InvokeResolver = ($this: GetValueFunc, args: readonly GetValueFunc[]) => E.Either<ParseError, CompileTimeObject>;

export interface CompileTimeObject {
    readonly node: tsm.Node;
    readonly symbol?: tsm.Symbol;

    readonly loadOps: ReadonlyArray<Operation>;
    readonly storeOps?: ReadonlyArray<Operation>;
    readonly properties?: ReadonlyMap<string, PropertyResolver>;
    readonly call?: InvokeResolver;
    readonly callNew?: InvokeResolver;
}

export type CompileTimeValue = Pick<CompileTimeObject, 'node' | 'loadOps'>;

export interface CompileTimeType {
    readonly type: tsm.Type;
    readonly properties?: ReadonlyMap<tsm.Symbol, PropertyResolver>;
    readonly call?: InvokeResolver;
    readonly callNew?: InvokeResolver;
}

export interface Scope {
    readonly parentScope: O.Option<Scope>;
    readonly symbols: ReadonlyMap<tsm.Symbol, CompileTimeObject>;
    readonly types: ReadonlyMap<tsm.Type, CompileTimeType>;
}

export const createEmptyScope = (parentScope?: Scope): Scope => {
    return {
        parentScope: O.fromNullable(parentScope),
        symbols: new Map(),
        types: new Map(),
    };
};

const makeScope =
    (parentScope: O.Option<Scope>) =>
        (ctos: readonly CompileTimeObject[], ctts: readonly CompileTimeType[] = []): Scope => {

            const symbols = pipe(
                ctos,
                ROA.filter(cto => !!cto.symbol),
                ROA.map(cto => [cto.symbol!, cto] as const),
                entries => new Map(entries),
                ROM.fromMap,
            )
            const types = pipe(
                ctts,
                ROA.map(ctt => [ctt.type, ctt] as const),
                entries => new Map(entries),
                ROM.fromMap,
            )
            return { parentScope, symbols, types };
        };


export const createScope =
    (parentScope?: Scope) =>
        (ctos: readonly CompileTimeObject[], ctts: readonly CompileTimeType[] = []): Scope => {
            return makeScope(O.fromNullable(parentScope))(ctos, ctts);
        };

export const updateScope =
    (scope: Scope) =>
        (
            symbols?: CompileTimeObject | readonly CompileTimeObject[],
            types?: CompileTimeType | readonly CompileTimeType[]
        ): Scope => {
            symbols = symbols ? isArray(symbols) ? symbols : [symbols] : [];
            symbols = ROA.concat(symbols)([...scope.symbols.values()]);
            types = types ? isArray(types) ? types : [types] : [];
            types = ROA.concat(types)([...scope.types.values()]);
            return makeScope(scope.parentScope)(symbols, types);
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

export const resolveName = (scope: Scope) => (name: string): O.Option<CompileTimeObject> => {
    for (const [symbol, cto] of scope.symbols.entries()) {
        if (symbol.getName() === name) return O.some(cto);
    }
    return O.isSome(scope.parentScope) ? resolveName(scope.parentScope.value)(name) : O.none;
}

export const resolveType = (scope: Scope) => (type: tsm.Type): O.Option<CompileTimeType> => {
    return pipe(
        scope.types.get(type),
        O.fromNullable,
        O.alt(() => pipe(
            scope.parentScope,
            O.chain(p => resolveType(p)(type))
        ))
    );
};

