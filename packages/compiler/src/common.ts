import * as m from "ts-morph";

export interface Scope {
    readonly scopeName: string;
    readonly enclosingScope: Scope | undefined;
    getSymbols(): IterableIterator<Symbol>;
    define<T extends Symbol>(symbolFactory: (scope: Scope) => T): T;
    resolve(name:string): Symbol | undefined;
}

export interface Symbol {
    readonly name: string;
    readonly scope: Scope;
}

export abstract class ScopeBase implements Scope {

    private readonly _symbols = new Map<string, Symbol>();

    abstract scopeName: string;
    abstract enclosingScope: Scope | undefined;

    getSymbols() { return this._symbols.values(); }

    resolve(name: string) {
        const value = this._symbols.get(name);
        return value ? value : undefined;
    }

    define<T extends Symbol>(symbolFactory: (scope: Scope) => T): T {
        var value = symbolFactory(this);
        this._symbols.set(value.name, value);
        return value;
    }
}

export class GlobalScope extends ScopeBase {
    scopeName = "<global>";
    enclosingScope = undefined;
}

export class ScopeSymbol extends ScopeBase implements Symbol {

    constructor(readonly node: m.NameableNode, readonly scope: Scope) {
        super();
        this.name = node.getNameOrThrow();
        this.scopeName = this.name;
        this.enclosingScope = scope;
    }

    readonly name: string;
    readonly scopeName: string;
    readonly enclosingScope: Scope;
}

export class VariableSymbol implements Symbol {
    constructor(readonly decl: m.VariableDeclaration, readonly scope: Scope) 
    { 
        this.name = decl.getName();
    }

    readonly name:string;
}

export class ParameterSymbol implements Symbol {
    constructor(readonly decl: m.ParameterDeclaration, readonly index: number, readonly scope: Scope)
    {
        this.name = decl.getName();
    }

    readonly name:string;
}

export class FunctionScope extends ScopeSymbol {
    constructor(readonly decl: m.FunctionDeclaration, scope: Scope) {
        super(decl, scope);
    }
}

export class BlockScope extends ScopeBase {
    constructor(readonly decl: m.Block, readonly enclosingScope: Scope) {
        super();
    }
    scopeName = "<block>";
}
