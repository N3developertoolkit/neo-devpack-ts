import * as tsm from "ts-morph";
import { resolveBuiltIn } from "./builtins";
import { CompileError } from "./compiler";
import { DefineSymbolFunction, Scope, SymbolDefinition } from "./types/CompileContext";
import { SlotType } from "./types/OperationBuilder";
import { transform } from "./utility/nodeDispatch";
import { getSymbolOrCompileError } from "./utils";

export class ByteString extends Uint8Array {
    constructor(array: ArrayLike<number> | ArrayBufferLike) {
        super(array);
    }
}

export type ConstantValue = boolean | number | bigint | ByteString;

class SymbolMap {
    private readonly map = new Map<tsm.Symbol, SymbolDefinition>();

    constructor(readonly scope: Scope) { }

    getSymbols() { return this.map.values(); }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>): T {
        const instance = typeof factory === 'function' ? factory(this.scope) : factory;
        if (instance.parentScope !== this.scope) {
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
        return neoSymbol ?? this.scope.parentScope?.resolve(symbol);
    }
}

abstract class ScopeImpl implements Scope {
    private readonly map: SymbolMap;

    constructor(readonly name: string, readonly parentScope: Scope) {
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

abstract class ScopedSymbolDefinition extends ScopeImpl implements SymbolDefinition {

    constructor(
        readonly node: tsm.Node,
        readonly parentScope: Scope
    ) {
        const symbol = getSymbolOrCompileError(node);
        super(`${symbol.getName()}`, parentScope);
        this.symbol = symbol;
    }

    readonly symbol: tsm.Symbol;
}

export class BlockScope extends ScopeImpl {
    constructor(
        readonly node: tsm.Block,
        scope: Scope
    ) {
        super("<block>", scope);
    }
}

export class FunctionSymbolDefinition extends ScopedSymbolDefinition {
    constructor(
        readonly node: tsm.FunctionDeclaration,
        scope: Scope
    ) {
        super(node, scope);

        const params = node.getParameters();
        const paramsLength = params.length;
        for (let i = 0; i < paramsLength; i++) {
            this.define(s => new ParameterSymbolDefinition(params[i], s, i));
        }
    }
}

export class ConstantValueSymbolDefinition implements SymbolDefinition {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: Scope,
        readonly value: ConstantValue
    ) {
    }
}

export class VariableSymbolDefinition implements SymbolDefinition {
    readonly symbol: tsm.Symbol;
    constructor(
        readonly node: tsm.VariableDeclaration,
        readonly parentScope: Scope,
        readonly slotType: SlotType,
        readonly index: number,
    ) {
        this.symbol = getSymbolOrCompileError(node);
    }

    get declarationKind() { return this.node.getVariableStatementOrThrow().getDeclarationKind(); }
    get initializer() { return this.node.getInitializer(); }
}

export class ParameterSymbolDefinition implements SymbolDefinition {
    readonly symbol: tsm.Symbol;
    readonly index: number;
    constructor(
        readonly node: tsm.ParameterDeclaration,
        readonly parentScope: Scope,
        index?: number,
    ) {
        this.symbol = getSymbolOrCompileError(node);
        if (index) {
            this.index = index;
        } else {
            const parent = node.getParent();
            if (!tsm.Node.isParametered(parent)) { throw new CompileError(`Invalid ParameterDeclaration Parent`, parent); }
            this.index = parent.getParameters().findIndex(v => v === node);
            if (this.index < 0) { throw new CompileError(`Could not find ParameterDeclaration`, parent); }
        }
    }
}

class GlobalScope implements Scope {
    private readonly map: SymbolMap;

    constructor() {
        this.map = new SymbolMap(this);
    }

    readonly name = "<global>";
    readonly parentScope = undefined;

    getSymbols() { return this.map.getSymbols(); }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>) {
        return this.map.define(factory);
    }

    resolve(symbol: tsm.Symbol): SymbolDefinition | undefined {
        const resolved = this.map.resolve(symbol);
        return resolved ?? resolveBuiltIn(symbol, this);
    }
}

function getConstantValue(node: tsm.VariableDeclaration, declKind: tsm.VariableDeclarationKind) {
    if (declKind !== tsm.VariableDeclarationKind.Const) return undefined;

    const init = node.getInitializerOrThrow();

    return transform<ConstantValue | undefined>(init, {
        [tsm.SyntaxKind.BigIntLiteral]: (node) => {
            return node.getLiteralValue() as bigint;
        },
        [tsm.SyntaxKind.FalseKeyword]: (node) => {
            return node.getLiteralValue();
        },
        [tsm.SyntaxKind.NumericLiteral]: (node) => {
            const literal = node.getLiteralValue();
            if (!Number.isInteger(literal)) throw new CompileError(`invalid non-integer numeric literal`, node);
            return literal;
        },
        [tsm.SyntaxKind.StringLiteral]: (node) => {
            return new ByteString(Buffer.from(node.getLiteralValue(), 'utf-8'));
        },
        [tsm.SyntaxKind.TrueKeyword]: (node) => {
            return node.getLiteralValue();
        }
    }, {
        missing: (node) => { return undefined; }
    });
}

export function createSymbolTable(project: tsm.Project): Scope {
    const globals = new GlobalScope();

    let staticSlotCount = 0;
    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;

        src.forEachChild(node => {

            if (tsm.Node.isFunctionDeclaration(node)) {
                globals.define(s => new FunctionSymbolDefinition(node, s));
            }
            else if (tsm.Node.isVariableStatement(node)) {
                const declKind = node.getDeclarationKind();

                for (const decl of node.getDeclarations()) {
                    const value = getConstantValue(decl, declKind);
                    if (value !== undefined) {
                        const symbol = decl.getSymbolOrThrow();
                        globals.define(s => new ConstantValueSymbolDefinition(symbol, s, value));
                    } else {
                        globals.define(s => new VariableSymbolDefinition(decl, s, SlotType.Static, staticSlotCount++));
                    }
                }
            }
        });
    }

    return globals;
}