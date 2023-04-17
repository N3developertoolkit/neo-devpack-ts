import * as tsm from "ts-morph";
import * as E from "fp-ts/Either";
import { Operation } from "./Operation";
import { ParseError } from "../utils";
// madge reports this as a circular dependency, but I think it's ok since we're using `import type` here
import type  { Scope } from "./Scope";

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
