import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import { CallableSymbolDef, ObjectSymbolDef, ParseError, SymbolDef } from "./types/ScopeType";
import { createDiagnostic as $createDiagnostic } from "./utils";

export const makeParseError =
    (node?: tsm.Node) =>
        (e: string | unknown): ParseError => {
            const message = typeof e === 'string'
                ? e : e instanceof Error
                    ? e.message : String(e);
            return { message, node };
        }

export const makeParseDiagnostic = (e: ParseError) => $createDiagnostic(e.message, { node: e.node });

export function isObjectDef(def: SymbolDef): def is ObjectSymbolDef {
    return 'props' in def;
}

export function isCallableDef(def: SymbolDef): def is CallableSymbolDef {
    return isObjectDef(def) && 'parseArguments' in def;
}

export const parseLoadOps =
    (node: tsm.Node) => (def: SymbolDef) => pipe(
        def.loadOps,
        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} has no load ops`))
    );

export const parseStoreOps =
    (node: tsm.Node) => (def: SymbolDef) => pipe(
        def.storeOps,
        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} has no store ops`))
    );

export class $SymbolDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly type: tsm.Type;

    get name() { return this.symbol.getName(); }
    get typeName() { return this.type.getSymbol()?.getName(); }

    protected constructor(readonly node: tsm.Node, symbol?: tsm.Symbol) {
        this.symbol = symbol ?? node.getSymbolOrThrow();
        this.type = node.getType();
    }
}
