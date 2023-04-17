import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import { CallableSymbolDef, ObjectSymbolDef, SymbolDef } from "./types/ScopeType";
import { makeParseError } from "./utils";

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

export class $SymbolDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly type: tsm.Type;

    readonly name: string;
    readonly typeName: string | undefined;

    protected constructor(readonly node: tsm.Node, symbol?: tsm.Symbol) {
        this.symbol = symbol ?? node.getSymbolOrThrow();
        this.type = node.getType();
        this.name = this.symbol.getName();
        this.typeName = this.type.getSymbol()?.getName();
    }
}
