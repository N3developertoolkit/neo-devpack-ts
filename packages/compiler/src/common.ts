import * as m from "ts-morph";

export enum SlotType { Argument, Local, Static }
export interface Scope {
    readonly scopeName: string;
    readonly parentScope: Scope | undefined;
    define<T extends Symbol>(symbol: T):void;
    getSymbols(): IterableIterator<Symbol>;
    resolve(name:string): Symbol | undefined;
}

export interface Symbol {
    readonly name: string;
    readonly scope: Scope;
}

export interface SlotSymbol extends Symbol {
    readonly type: SlotType;
    readonly index: number;
}

export function isSlotSymbol(symbol: Symbol): symbol is SlotSymbol {
    return 'type' in symbol && 'index' in symbol;    
}

export class ParameterSymbol implements SlotSymbol {
    get name() { return this.node.getName(); }
    readonly type = SlotType.Argument;

    constructor(
        readonly node: m.ParameterDeclaration, 
        readonly index: number, 
        readonly scope: Scope
    ) { }
}

export abstract class ScopeBase implements Scope {

    private readonly _symbols = new Map<string, Symbol>();

    abstract readonly scopeName: string;
    abstract readonly parentScope: Scope | undefined;

    define<T extends Symbol>(symbol: T): void {
        if (symbol.scope !== this) throw new Error();
        this._symbols.set(symbol.name, symbol);
    }

    getSymbols() { return this._symbols.values(); }

    resolve(name: string) { return this._symbols.get(name); }
}

export class GlobalScope extends ScopeBase {
    readonly scopeName = "<global>";
    readonly parentScope = undefined;
}

// export class ScopeSymbol extends ScopeBase implements Symbol {

//     constructor(readonly node: m.NameableNode, readonly scope: Scope) {
//         super();
//         this.name = node.getNameOrThrow();
//         this.scopeName = this.name;
//         this.parentScope = scope;
//     }

//     readonly name: string;
//     readonly scopeName: string;
//     readonly parentScope: Scope;
// }

// // export class VariableSymbol implements Symbol {
// //     constructor(readonly decl: m.VariableDeclaration, readonly scope: Scope) 
// //     { 
// //         this.name = decl.getName();
// //     }

// //     readonly name:string;
// // }



// export class FunctionScope extends ScopeSymbol {
//     constructor(readonly decl: m.FunctionDeclaration, scope: Scope) {
//         super(decl, scope);
//     }

//     defineParameters(params: m.ParameterDeclaration[]) {
//         for (let index = 0; index < params.length; index++) {
//             const element = params[index];
//             var symbol = new ParameterSymbol(params[index], index, this);
//             this.define(symbol);
//         }
//     }
// }

// // export class BlockScope extends ScopeBase {
// //     constructor(readonly decl: m.Block, readonly enclosingScope: Scope) {
// //         super();
// //     }
// //     scopeName = "<block>";
// // }
