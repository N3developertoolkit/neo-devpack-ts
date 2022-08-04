import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { DefineSymbolFunction, NeoScope, SymbolDefinition } from "./types/CompileContext";
import { SymbolMap } from "./types/SymbolMap";

function getSymbolOrCompileError(node: tsm.Node) {
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError("undefined symbol", node);
    return symbol;
}

abstract class ScopeSymbolDefinition implements NeoScope, SymbolDefinition {

    private readonly map: SymbolMap;

    get name() { return this.symbol.getName(); }
    get enclosingScope() { return this.scope; }
    get symbol() { return this.node.getSymbolOrThrow(); }

    constructor(
        readonly node: tsm.Node, 
        readonly scope: NeoScope
    ) {
        this.map = new SymbolMap(this);
    }

    getSymbols() {
        return this.map.getSymbols();
    }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>) {
        return this.map.define(factory);
    }

    resolve(symbol: tsm.Symbol): SymbolDefinition | undefined {
        return this.map.resolve(symbol);
    }

}
export class NeoFunctionDeclaration extends ScopeSymbolDefinition {
    constructor(
        readonly node: tsm.FunctionDeclaration,
        readonly scope: NeoScope
    ) {
        super(node, scope);
    }
}

export class NeoVariableDeclaration implements SymbolDefinition {
    readonly symbol: tsm.Symbol;
    constructor(
        readonly node: tsm.VariableDeclaration,
        readonly scope: NeoScope
    ) {
        this.symbol = getSymbolOrCompileError(node);
    }
}

export class NeoParameterDeclaration implements SymbolDefinition {
    readonly symbol: tsm.Symbol;
    constructor(
        readonly node: tsm.ParameterDeclaration,
        readonly scope: NeoScope
    ) {
        this.symbol = getSymbolOrCompileError(node);
    }
}

class GlobalScope implements NeoScope {
    private readonly map: SymbolMap;

    constructor() {
        this.map = new SymbolMap(this);
    }

    readonly name = "<global>";
    readonly enclosingScope = undefined;

    getSymbols() { return this.map.getSymbols(); }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>) {
        return this.map.define(factory);
    }

    resolve(symbol: tsm.Symbol) {
        const resolved =  this.map.resolve(symbol);
        return resolved ?? this.resolveBuiltIn(symbol);
    }

    private resolveBuiltIn(symbol: tsm.Symbol): SymbolDefinition | undefined {
        // TODO: implement
        return undefined;
    }
}

export function createSymbolTable(project: tsm.Project): NeoScope {
    const globals = new GlobalScope();

    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;

        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                const neo = globals.define(s => new NeoFunctionDeclaration(node, s));
                for (const param of node.getParameters()) {
                    neo.define(s => new NeoParameterDeclaration(param, s));
                }
            } else if (tsm.Node.isVariableStatement(node)) {
                for (const decl of node.getDeclarations()) {
                    globals.define(s => new NeoVariableDeclaration(decl, s));
                }
            }
        });
    }

    return globals;
}

