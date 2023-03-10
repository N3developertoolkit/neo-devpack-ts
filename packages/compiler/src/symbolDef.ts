import { Operation } from "./types/Operation";
import { createDiagnostic as $createDiagnostic } from "./utils";

import { ts, Node, Symbol, CallExpression, Type } from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import { Scope } from "./scope";

type Diagnostic = ts.Diagnostic;

export interface ParseError { message: string, node?: Node }

export const makeParseError =
    (node?: Node) =>
        (e: string | unknown): ParseError => {
            const message = typeof e === 'string'
                ? e : e instanceof Error
                    ? e.message : String(e);
            return { message, node };
        }

export const makeParseDiagnostic = (e: ParseError) => $createDiagnostic(e.message, { node: e.node });

export interface SymbolDef {
    readonly symbol: Symbol;
    readonly type: Type;
    readonly loadOps?: ReadonlyArray<Operation>;
    readonly storeOps?: ReadonlyArray<Operation>;
}

export interface ObjectSymbolDef extends SymbolDef {
    readonly props: ReadonlyArray<SymbolDef>;
}

export function isObjectDef(def: SymbolDef): def is ObjectSymbolDef {
    return 'props' in def;
}

export interface CallableSymbolDef extends ObjectSymbolDef {
    parseArguments: (node: CallExpression, scope: Scope) => E.Either<ParseError, ReadonlyArray<Operation>>
}

export function isCallableDef(def: SymbolDef): def is CallableSymbolDef {
    return isObjectDef(def) && 'parseArguments' in def;
}

export const parseLoadOps =
    (node: Node) => (def: SymbolDef) => pipe(
        def.loadOps,
        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} has no load ops`))
    );

export class $SymbolDef implements SymbolDef {
    readonly symbol: Symbol;
    readonly type: Type;

    get name() { return this.symbol.getName(); }
    get typeName() { return this.type.getSymbol()?.getName(); }

    protected constructor(
        private readonly node: Node,
        private _symbol?: Symbol
    ) {
        this.symbol = _symbol ?? node.getSymbolOrThrow();
        this.type = node.getType();
    }
}
