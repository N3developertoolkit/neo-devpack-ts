import './ext';
import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { MethodBuilder } from "./passes/MethodBuilder";
import { dispatch } from "./utility/nodeDispatch";
import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
import { getConstantValue, getJSDocTag } from "./utils";

export interface ReadonlyScope {
    readonly parentScope: ReadonlyScope | undefined;
    readonly symbols: IterableIterator<SymbolDef>;
    resolve(symbol: tsm.Symbol): SymbolDef | undefined;
}

export interface Scope extends ReadonlyScope {
    define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T;
}

export function isScope(scope: ReadonlyScope): scope is Scope {
    return 'define' in scope && typeof scope.define === 'function';
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










export class GlobalScope implements Scope {
    private readonly map = new Map<tsm.Symbol, SymbolDef>();
    readonly parentScope = undefined;

    get symbols(): IterableIterator<SymbolDef> {
        return this.map.values();
    }

    resolve(symbol: tsm.Symbol) {
        return resolve(this.map, symbol);
    }

    define<T extends SymbolDef>(factory: T | ((scope: ReadonlyScope) => T)) {
        return define(this, this.map, factory);
    }
}

export class BlockScope implements Scope {
    private readonly map = new Map<tsm.Symbol, SymbolDef>();

    constructor(
        readonly node: tsm.Block,
        readonly parentScope: ReadonlyScope,
    ) {
    }

    get symbols() {
        return this.map.values();
    }

    resolve(symbol: tsm.Symbol) {
        return resolve(this.map, symbol, this.parentScope);
    }

    define<T extends SymbolDef>(factory: T | ((scope: ReadonlyScope) => T)) {
        return define(this, this.map, factory);
    }
}

export class MethodSymbolDef implements SymbolDef, ReadonlyScope {
    private readonly map: ReadonlyMap<tsm.Symbol, SymbolDef>;

    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly node: tsm.FunctionDeclaration,
    ) {
        const params = node.getParameters();
        const map = new Map<tsm.Symbol, SymbolDef>();
        for (let index = 0; index < params.length; index++) {
            const param = params[index];
            define(this, map, new VariableSymbolDef(param.getSymbolOrThrow(), this, 'arg', index));
        }
        this.map = map;
    }

    get symbols(): IterableIterator<SymbolDef> {
        return this.map.values();
    }

    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        return resolve(this.map, symbol, this.parentScope);
    }
}











export class ConstantSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly value: boolean | bigint | null | ReadonlyUint8Array,
    ) { }

    load(builder: MethodBuilder) {
        if (this.value === null) {
            builder.pushNull();
        } else if (this.value instanceof Uint8Array) {
            builder.pushData(this.value);
        } else {
            switch (typeof this.value) {
                case 'boolean':
                    builder.pushBoolean(this.value as boolean);
                    break;
                case 'bigint':
                    builder.pushInt(this.value as bigint);
                    break;
                default:
                    throw new Error(`ConstantSymbolDef load ${this.value}`)
            }
        }
    }
}

export class VariableSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly kind: 'arg' | 'local' | 'static',
        readonly index: number
    ) {
    }

    load(builder: MethodBuilder) {
        builder.load(this.kind, this.index);
    }

    store(builder: MethodBuilder) {
        builder.store(this.kind, this.index);
    }
}

export class EventSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly signature: tsm.Signature,
        readonly parentScope: ReadonlyScope,
        readonly name: string,
    ) {
    }
}

export class SysCallSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly signature: tsm.Signature,
        readonly parentScope: ReadonlyScope,
        readonly name: string,
    ) {
    }
}




































interface ScopeOptions {
    scope: Scope,
    symbol?: tsm.Symbol
}

// Defining a strongly typed event by declaring a function with an @event JsDoc tag. 
//  /** @event */
//  declare function Transfer(from: Address | undefined, to: Address | undefined, amount: bigint): void;
function processFunctionDeclaration(node: tsm.FunctionDeclaration, options: ScopeOptions) {
    const symbol = options.symbol ?? node.getSymbolOrThrow();
    const scope = options.scope;
    const signature = node.getSignature();

    if (node.hasDeclareKeyword()) {

        const syscallTag = getJSDocTag(node, "syscall");
        if (syscallTag) {
            const name = syscallTag.getCommentText();
            if (!name || name.length === 0) throw new CompileError('invalid syscall tag', node);
            scope.define(s => new SysCallSymbolDef(symbol, signature, s, name));
            return;
        }

        const eventTag = getJSDocTag(node, "event");
        if (eventTag) {
            const name = eventTag.getCommentText();
            if (!name || name.length === 0) throw new CompileError('invalid syscall tag', node);
            scope.define(s => new EventSymbolDef(symbol, signature, s, name));
            return;
        } 
        
        throw new CompileError("not supported", node);
    } else {
        scope.define(s => new MethodSymbolDef(symbol, s, node));
    }
}

// function processSCFXImportSpecifier(decls: tsm.ExportedDeclarations[], options: ScopeOptions) {
//     if (decls.length !== 1) throw new Error('not implemented');
//     const decl = decls[0];
//     if (tsm.Node.isVariableDeclaration(decl)) {
//         processVariableDeclaration(decl, options);
//     }
// }

function processImportSpecifier(node: tsm.ImportSpecifier, options: ScopeOptions) {
    const $module = node.getImportDeclaration().getModuleSpecifierSourceFileOrThrow();
    const $moduleExports = $module.getExportedDeclarations();
    const symbol = node.getSymbolOrThrow();
    const name = (symbol.getAliasedSymbol() ?? symbol).getName();
    const $export = $moduleExports.get(name);
    if (!$export) throw new CompileError("not found", node);
    if ($export.length !== 1) throw new CompileError("not implemented", node);
    processScopeNode($export[0], { scope: options.scope, symbol});
}

function processImportDeclaration(node: tsm.ImportDeclaration, {scope}: ScopeOptions) {
    for (const $import of node.getNamedImports()) {
        processImportSpecifier($import, {scope});
    }
}

function processVariableDeclaration(node: tsm.VariableDeclaration, options: ScopeOptions) {
    const declKind = node.getVariableStatementOrThrow().getDeclarationKind();
    const symbol = options.symbol ?? node.getSymbolOrThrow();

    if (declKind === tsm.VariableDeclarationKind.Const) {
        const init = node.getInitializer();
        if (!init) { throw new CompileError("missing initializer", node); }
        const value = getConstantValue(init);
        options.scope.define(s => new ConstantSymbolDef(symbol, s, value));
    } else {
        throw new CompileError(`not implemented`, node);
    }
}

function processVariableStatement(node: tsm.VariableStatement, {scope}: ScopeOptions) {
    for (const decl of node.getDeclarations()) {
        processVariableDeclaration(decl, {scope});
    }
}

function processScopeNode(node: tsm.Node, options: ScopeOptions) {
    dispatch(node, options, {
        [tsm.SyntaxKind.FunctionDeclaration]: processFunctionDeclaration,
        [tsm.SyntaxKind.ImportDeclaration]: processImportDeclaration,
        [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
        [tsm.SyntaxKind.EndOfFileToken]: () => { },
    });
}

export function createGlobalScope(src: tsm.SourceFile): ReadonlyScope {
    if (src.isDeclarationFile()) throw new CompileError(`can't createGlobalScope for declaration file`, src);

    const scope = new GlobalScope();
    src.forEachChild(node => processScopeNode(node, { scope }));
    return scope;
}