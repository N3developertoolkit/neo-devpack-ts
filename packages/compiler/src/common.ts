import * as m from "ts-morph";

export interface Scope {
    readonly scopeName: string;
    readonly enclosingScope: Scope | undefined;
    getSymbols(): IterableIterator<Symbol>;
    define<T extends Symbol>(symbol: T):void;
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

    define<T extends Symbol>(symbol: T): void {
        if (symbol.scope !== this) throw new Error();
        this._symbols.set(symbol.name, symbol);
    }

    resolve(name: string) {
        const value = this._symbols.get(name);
        return value ? value : undefined;
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

// export class VariableSymbol implements Symbol {
//     constructor(readonly decl: m.VariableDeclaration, readonly scope: Scope) 
//     { 
//         this.name = decl.getName();
//     }

//     readonly name:string;
// }

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

    defineParameters(params: m.ParameterDeclaration[]) {
        for (let index = 0; index < params.length; index++) {
            const element = params[index];
            var symbol = new ParameterSymbol(params[index], index, this);
            this.define(symbol);
        }
    }
}

// export class BlockScope extends ScopeBase {
//     constructor(readonly decl: m.Block, readonly enclosingScope: Scope) {
//         super();
//     }
//     scopeName = "<block>";
// }
