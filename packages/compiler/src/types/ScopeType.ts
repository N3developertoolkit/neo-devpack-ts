import * as tsm from "ts-morph";
import * as O from 'fp-ts/Option';
import * as E from "fp-ts/Either";
import { Operation } from "./Operation";


export interface Scope {
    readonly parentScope: O.Option<Scope>;
    readonly symbols: ReadonlyMap<tsm.Symbol, SymbolDef>;
}

export interface SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly type: tsm.Type;
    readonly loadOps?: ReadonlyArray<Operation>;
    readonly parseStore?: (loadOps: readonly Operation[], valueOps: readonly Operation[]) => E.Either<ParseError, readonly Operation[]>;
}

export interface ObjectSymbolDef extends SymbolDef {
    readonly props: ReadonlyArray<SymbolDef>;
}

export interface ParseError { message: string, node?: tsm.Node }

export type ParseArgumentsFunc = (scope: Scope) => (node: tsm.CallExpression) => E.Either<ParseError, ReadonlyArray<Operation>>;

export interface CallableSymbolDef extends ObjectSymbolDef {
    parseArguments: ParseArgumentsFunc;
}
