import './ext';
import * as tsm from "ts-morph";
import { CompileContext, CompileError } from "./compiler";
import { dispatch } from "./utility/nodeDispatch";
import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
import { createDiagnostic, getConstantValue, getJSDocTag, isVoidLike } from "./utils";
import { from } from 'ix/iterable';
import { map, orderBy } from 'ix/iterable/operators';
import { emitU8ArrayFrom } from './passes/builtins';
import { ProcessMethodOptions } from './passes/processFunctionDeclarations';

export interface ReadonlyScope {
    readonly parentScope: ReadonlyScope | undefined;
    readonly symbols: IterableIterator<SymbolDef>;
    resolve(symbol?: tsm.Symbol): SymbolDef | undefined;
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

export function canResolve(def: SymbolDef): def is SymbolDef & ReadonlyScope {
    return 'resolve' in def && typeof def.resolve === 'function';
}

function resolve(map: ReadonlyMap<tsm.Symbol, SymbolDef>, symbol?: tsm.Symbol, parent?: ReadonlyScope) {
    if (!symbol) return undefined;
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

    resolve(symbol?: tsm.Symbol): SymbolDef | undefined {
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

    resolve(symbol?: tsm.Symbol) {
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

    resolve(symbol?: tsm.Symbol): SymbolDef | undefined {
        return resolve(this.map, symbol, this.parentScope);
    }
}













export class IntrinsicSymbolDef implements SymbolDef {
    readonly symbol: tsm.Symbol;

    constructor(
        readonly node: tsm.VariableDeclaration,
        readonly parentScope: ReadonlyScope
    ) {
        this.symbol = node.getSymbolOrThrow();
    }
}

export class IntrinsicMethodDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly emitCall: (args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) => void
    ) { }
}

export class ConstantSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly value: boolean | bigint | null | ReadonlyUint8Array
    ) { }

}

export class VariableSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly kind: 'arg' | 'local' | 'static',
        readonly index: number
    ) { }
}

export class EventSymbolDef implements SymbolDef {
    readonly parameters: ReadonlyArray<tsm.ParameterDeclaration>;
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly name: string,
        node: tsm.FunctionDeclaration,
    ) {
        if (!node.hasDeclareKeyword()) throw new CompileError('invalid', node);
        if (!isVoidLike(node.getReturnType())) throw new CompileError('invalid', node);
        this.parameters = node.getParameters();
    }
}

export class SysCallSymbolDef implements SymbolDef {
    readonly parameters: ReadonlyArray<tsm.ParameterDeclaration>;
    readonly returnType: tsm.Type;

    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: ReadonlyScope,
        readonly name: string,
        node: tsm.FunctionDeclaration,
    ) {
        if (!node.hasDeclareKeyword()) throw new CompileError('invalid', node);
        this.parameters = node.getParameters();
        this.returnType = node.getReturnType();
    }
}





































interface ScopeOptions {
    diagnostics: Array<tsm.ts.Diagnostic>;
    scope: Scope,
    symbol?: tsm.Symbol
}

function processFunctionDeclaration(node: tsm.FunctionDeclaration, options: ScopeOptions) {
    const symbol = options.symbol ?? node.getSymbolOrThrow();
    const scope = options.scope;

    if (node.hasDeclareKeyword()) {
        const syscallTag = getJSDocTag(node, "syscall");
        if (syscallTag) {
            const name = syscallTag.getCommentText();
            if (!name || name.length === 0) throw new CompileError('invalid syscall tag', node);
            scope.define(s => new SysCallSymbolDef(symbol, s, name, node));
            return;
        }

        const eventTag = getJSDocTag(node, "event");
        if (eventTag) {
            const name = eventTag.getCommentText() ?? symbol.getName();
            if (!name || name.length === 0) throw new CompileError('invalid event tag', node);
            scope.define(s => new EventSymbolDef(symbol, s, name, node));
            return;
        }

        throw new CompileError("not supported", node);
    } else {
        scope.define(s => new MethodSymbolDef(symbol, s, node));
    }
}

function processImportSpecifier(node: tsm.ImportSpecifier, { diagnostics, scope }: ScopeOptions) {
    const $module = node.getImportDeclaration().getModuleSpecifierSourceFileOrThrow();
    const $moduleExports = $module.getExportedDeclarations();
    const symbol = node.getSymbolOrThrow();
    const name = (symbol.getAliasedSymbol() ?? symbol).getName();
    const exportDecls = $moduleExports.get(name);
    if (!exportDecls) {
        diagnostics.push(createDiagnostic(`${name} import not found`, { node }));
        return;
    }
    if (exportDecls.length !== 1) {
        diagnostics.push(createDiagnostic(`multiple exported declarations not implemented`, { node }));
        return;
    }
    for (const decl of exportDecls) {
        processScopeNode(decl, { diagnostics, scope, symbol });
    }
}

function processImportDeclaration(node: tsm.ImportDeclaration, { diagnostics, scope }: ScopeOptions) {
    for (const $import of node.getNamedImports()) {
        processImportSpecifier($import, { diagnostics, scope });
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

function processVariableStatement(node: tsm.VariableStatement, { diagnostics, scope }: ScopeOptions) {
    for (const decl of node.getDeclarations()) {
        processVariableDeclaration(decl, { diagnostics, scope });
    }
}

function processScopeNode(node: tsm.Node, options: ScopeOptions) {
    dispatch(node, options, {
        [tsm.SyntaxKind.FunctionDeclaration]: processFunctionDeclaration,
        [tsm.SyntaxKind.InterfaceDeclaration]: () => { },
        [tsm.SyntaxKind.ImportDeclaration]: processImportDeclaration,
        [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
        [tsm.SyntaxKind.EndOfFileToken]: () => { },
    });
}

function test(fs: tsm.FileSystemHost, cur?: string) {
    if (!cur) cur = fs.getCurrentDirectory();
    console.log(cur);
    const entries = fs.readDirSync(cur);
    for (const e of entries) {
        if (e.isFile) console.log("  " + e.name);
        if (e.isDirectory) test(fs, e.name);
    }
}

interface Declarations {
    functions: Array<tsm.FunctionDeclaration>,
    interfaces: Array<tsm.InterfaceDeclaration>,
    // typeAliases: Array<tsm.TypeAliasDeclaration>,
    // modules: Array<tsm.ModuleDeclaration>,
    variables: Array<tsm.VariableDeclaration>,
}

const LIB_PATH = `/node_modules/typescript/lib/`;

// this code iterates thru the project's library declaration files. For now, we're just using ES2020,
// though eventually we will likely want our own declaration file(s)
function $getDeclarations(node: tsm.SourceFile | undefined, decls: Declarations, files?: Set<string>) {

    if (!node) return;
    if (!files) files = new Set<string>();

    // ensure each library decalaration file is only processed once
    const path = node.getFilePath();
    if (files.has(path)) return;
    files.add(path);

    // Loop thru the declarations in this file, adding each to the appropriate declaration array
    node.forEachChild(n => {
        switch (n.getKind()) {
            case tsm.SyntaxKind.FunctionDeclaration:
                decls.functions.push(n as tsm.FunctionDeclaration);
                break;
            case tsm.SyntaxKind.InterfaceDeclaration:
                decls.interfaces.push(n as tsm.InterfaceDeclaration);
                break;
            case tsm.SyntaxKind.TypeAliasDeclaration:
                // decls.typeAliases.push(n as tsm.TypeAliasDeclaration);
                break;
            case tsm.SyntaxKind.ModuleDeclaration:
                // decls.modules.push(n as tsm.ModuleDeclaration);
                break;
            case tsm.SyntaxKind.VariableStatement:
                decls.variables.push(...(n as tsm.VariableStatement).getDeclarations());
                break;
            case tsm.SyntaxKind.EndOfFileToken:
                break;
            default:
                throw new Error(`${n.getKindName()}`);
        }
    });

    // loop thru the library references in the file and recursively call $getDeclarations
    const prj = node.getProject();
    for (const ref of node.getLibReferenceDirectives()) {
        const path = LIB_PATH + `lib.${ref.getFileName()}.d.ts`;
        $getDeclarations(prj.getSourceFile(path), decls, files);
    }
}

function getDeclarations(project: tsm.Project) {
    const decls = {
        functions: new Array<tsm.FunctionDeclaration>(),
        interfaces: new Array<tsm.InterfaceDeclaration>(),
        variables: new Array<tsm.VariableDeclaration>(),
    };

    // call $getDeclarations for each top level library declaration file in the project
    const libs = project.compilerOptions.get().lib ?? [];
    for (const lib of libs) {
        const src = project.getSourceFile(LIB_PATH + lib);
        $getDeclarations(src, decls);
    }

    // create a map of strings to the declaration's symbol
    const variables = new Map(from(decls.variables).pipe(
        map(x => [x.getSymbolOrThrow().getName(), x] as [string, tsm.VariableDeclaration]),
        orderBy(x => x[0])
    ));

    // const functions = new Map(from(decls.functions).pipe(
    //     map(x => x.getSymbolOrThrow()),
    //     orderBy(x => x.getName()),
    //     map(x => [x.getName(), x])));
    // // note, interfaces can have multiple declarations which are merged 
    // // each declaration has a unique symbol, but the interface Type and type's symbol) is
    // // shared across all the declarations. So for interfaces, first create a set of type symbols
    // // to weed out duplicates, then create a string -> symbol map from the set values
    // const interfaceSet = new Set(from(decls.interfaces).pipe(map(x => x.getType().getSymbolOrThrow())));
    // const interfaces = new Map(from(interfaceSet.values()).pipe(
    //     orderBy(x => x.getName()),
    //     map(x => [x.getName(), x])));

    return { variables };
}

export function createSymbolTrees({ project, diagnostics, scopes }: CompileContext): void {

    const decls = getDeclarations(project);

    // intrinsics:
    const u8array = decls.variables.get("Uint8Array");
    const u8arrayFrom = u8array?.getType()?.getProperty("from");

    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        const scope = new GlobalScope();
        if (u8array) scope.define(s => new IntrinsicSymbolDef(u8array, s));
        if (u8arrayFrom) scope.define(s => new IntrinsicMethodDef(u8arrayFrom, s, emitU8ArrayFrom));
        src.forEachChild(node => processScopeNode(node, { diagnostics, scope }));
        scopes.push(scope);
    }
}