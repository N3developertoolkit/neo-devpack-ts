import * as tsm from "ts-morph";
import { DefineSymbolFunction, NeoScope, SymbolDefinition } from "./CompileContext";

export class SymbolMap {
    private readonly map = new Map<tsm.Symbol, SymbolDefinition>();

    constructor(readonly scope: NeoScope) { }

    getSymbols() { return this.map.values(); }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>): T {
        const instance = typeof factory === 'function' ? factory(this.scope) : factory;
        if (instance.scope !== this.scope) {
            throw new Error(`Invalid scope for ${instance.symbol.getName()}`);
        }
        if (this.map.has(instance.symbol)) {
            throw new Error(`${instance.symbol.getName()} already defined in this scope`);
        }
        this.map.set(instance.symbol, instance);
        return instance;
    }

    resolve(symbol: tsm.Symbol): SymbolDefinition | undefined {
        const neoSymbol = this.map.get(symbol);
        return neoSymbol ?? this.scope.enclosingScope?.resolve(symbol);
    }
}
