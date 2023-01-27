import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
import { getConstantValue, getSymbolOrCompileError } from "./utils";

export interface ReadonlyScope {
    readonly parentScope: ReadonlyScope | undefined;
    readonly symbols: IterableIterator<SymbolDef>;
    resolve(symbol: tsm.Symbol): SymbolDef | undefined;
}

export interface Scope extends ReadonlyScope {
    define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T;
}

export function isScope(scope: ReadonlyScope): scope is Scope {
    return 'define' in scope;
}

export interface SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly parentScope: ReadonlyScope;
}

function resolve(map: ReadonlyMap<tsm.Symbol, SymbolDef>, symbol: tsm.Symbol, parent?: ReadonlyScope) {
    const symbolDef = map.get(symbol);
    return symbolDef ?? parent?.resolve(symbol);
}

function define<T extends SymbolDef>(scope: ReadonlyScope, map: Map<tsm.Symbol, SymbolDef>, factory: T | ((scope: ReadonlyScope) => T)): T {
    const instance = typeof factory === 'function' ? factory(scope) : factory;
    if (instance.parentScope !== scope) {
        throw new Error(`Invalid scope for ${instance.symbol.getName()}`);
    }
    if (map.has(instance.symbol)) {
        throw new Error(`${instance.symbol.getName()} already defined in this scope`);
    }
    map.set(instance.symbol, instance);
    return instance;
}

export class GlobalScope implements ReadonlyScope {
    private readonly map = new Map<tsm.Symbol, SymbolDef>();
    readonly parentScope = undefined;

    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        return resolve(this.map, symbol);
    }

    define<T extends SymbolDef>(factory: T | ((scope: ReadonlyScope) => T)): T {
        return define(this, this.map, factory);
    }

    get symbols(): IterableIterator<SymbolDef> {
        return this.map.values();
    }
}

export class ConstantSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly value: boolean | bigint | null | ReadonlyUint8Array,
    ) {
    }
}

export class FunctionSymbolDef implements SymbolDef, ReadonlyScope {
    private readonly map = new Map<tsm.Symbol, SymbolDef>();
    readonly symbol: tsm.Symbol;

    constructor(
        readonly node: tsm.FunctionDeclaration,
        readonly parentScope: ReadonlyScope,
    ) {
        this.symbol = node.getSymbolOrThrow();

        const params = node.getParameters();
        for (let index = 0; index < params.length; index++) {
            define(this, this.map, s => new ParameterSymbolDef(params[index], s, index));
        }
    }

    get symbols(): IterableIterator<SymbolDef> {
        return this.map.values();
    }

    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        return resolve(this.map, symbol, this.parentScope);
    }
}

export class ParameterSymbolDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    constructor(
        readonly node: tsm.ParameterDeclaration,
        readonly parentScope: ReadonlyScope,
        readonly index: number
    ) {
        this.symbol = node.getSymbolOrThrow();
    }
}

export class VariableSymbolDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    constructor(
        readonly node: tsm.VariableDeclaration,
        readonly parentScope: ReadonlyScope,
        readonly index: number
    ) {
        this.symbol = node.getSymbolOrThrow();
    }
}
export class BlockScope implements Scope {
    private readonly map = new Map<tsm.Symbol, SymbolDef>();

    constructor(
        readonly node: tsm.Block,
        readonly parentScope: ReadonlyScope,
    ) {
    }

    define<T extends SymbolDef>(factory: T | ((scope: ReadonlyScope) => T)): T {
        return define(this, this.map, factory);
    }

    get symbols(): IterableIterator<SymbolDef> {
        return this.map.values();
    }

    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        return resolve(this.map, symbol, this.parentScope);
    }
}

// @internal
export function createGlobalScope(project: tsm.Project): ReadonlyScope {
    const globals = new GlobalScope();
    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        src.forEachChild(node => {
            const kind = node.getKindName();
            if (tsm.Node.isFunctionDeclaration(node)) {
                // TODO: if node.hasDeclareKeyword() == true then look for an @event JSDoc tag 
                if (!node.hasDeclareKeyword()) {
                    globals.define(s => new FunctionSymbolDef(node, s));
                }
            }
            else if (tsm.Node.isVariableStatement(node)
                && node.getDeclarationKind() === tsm.VariableDeclarationKind.Const
            ) {
                for (const decl of node.getDeclarations()) {
                    const symbol = decl.getSymbol();
                    if (symbol) {
                        const init = decl.getInitializer();
                        if (!init) throw new CompileError("Invalid const initializer", decl);
                        const value = getConstantValue(init);
                        globals.define(s => new ConstantSymbolDef(symbol, s, value));
                    }
                }
            }
        });
    }
    return globals;
}