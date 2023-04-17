import * as tsm from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import { CallableSymbolDef, ObjectSymbolDef, CompileTimeObject } from "./types/CompileTimeObject";
import { makeParseError } from "./utils";

export function isObjectDef(def: CompileTimeObject): def is ObjectSymbolDef {
    return 'props' in def;
}

export function isCallableDef(def: CompileTimeObject): def is CallableSymbolDef {
    return isObjectDef(def) && 'parseArguments' in def;
}

export const parseLoadOps =
    (node: tsm.Node) => (def: CompileTimeObject) => pipe(
        def.loadOps,
        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} has no load ops`))
    );

export class $SymbolDef implements CompileTimeObject {
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
