import * as m from "ts-morph";

export interface Scope {
    readonly parentScope: Scope | undefined;
    define<T extends Symbol>(symbol: T): void;
    getSymbols(): IterableIterator<Symbol>;
    resolve(name: string): Symbol | undefined;
}

export interface Symbol {
    readonly name: string;
    readonly scope: Scope;
}

export enum SlotType { Argument, Local, Static }

export class SlotSymbol implements Symbol {
    constructor(
        readonly node: m.Node & { getName(): string; },
        readonly index: number,
        readonly type: SlotType,
        readonly scope: Scope
    ) { }

    get name() { return this.node.getName(); }
}

export function isSlotSymbol(symbol: Symbol): symbol is SlotSymbol {
    return symbol instanceof SlotSymbol;
}

export class SymbolMap {
    private readonly _symbols = new Map<string, Symbol>();
    getSymbols() { return this._symbols.values(); }
    set(symbol: Symbol) { this._symbols.set(symbol.name, symbol) }
    resolve(name: string, parentScope?: Scope) { 
        var symbol = this._symbols.get(name);
        return symbol ? symbol : parentScope?.resolve(name);
    }
}

export class GlobalScope implements Scope {
    private symbols = new SymbolMap();

    get parentScope() { return undefined; }
    define<T extends Symbol>(symbol: T): void { this.symbols.set(symbol); }
    getSymbols(): IterableIterator<Symbol> { return this.symbols.getSymbols(); }
    resolve(name: string): Symbol | undefined { return this.symbols.resolve(name); }
}
