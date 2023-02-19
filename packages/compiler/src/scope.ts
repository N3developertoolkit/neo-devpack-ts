// import './ext';
// import * as tsm from "ts-morph";
// import { CompileContext, CompileError } from "./compiler";
// import { dispatch, NodeDispatchMap } from "./utility/nodeDispatch";
// import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
// import { createDiagnostic, getConstantValue, getJSDocTag, isVoidLike } from "./utils";
// import { from } from 'ix/iterable';
// import { map, orderBy } from 'ix/iterable/operators';
// import { ProcessMethodOptions } from './passes/processFunctionDeclarations';
// import { sc, u } from '@cityofzion/neon-core';
// import { CallOperation, CallTokenOperation, LoadStoreOperation, Operation, parseOperation, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation } from './types/Operation';
// import { ok as parseOK, error as parseError, ParseExpressionResult, parseCallArguments, parseArguments, DiagnosticResult } from './passes/expressionProcessor';
// import * as ROA from 'fp-ts/ReadonlyArray';
// import { flow, pipe } from 'fp-ts/lib/function';
// import * as E from "fp-ts/Either";
// import * as M from "fp-ts/Monoid";
// import * as O from 'fp-ts/Option'

// export interface ReadonlyScope {
//     readonly parentScope: ReadonlyScope | undefined;
//     readonly symbols: IterableIterator<SymbolDef>;
//     resolve(symbol?: tsm.Symbol): SymbolDef | undefined;
// }

// export interface Scope extends ReadonlyScope {
//     define(def: SymbolDef): void;
// }

// export function isScope(scope: ReadonlyScope): scope is Scope {
//     return 'define' in scope && typeof scope.define === 'function';
// }

// export interface SymbolDef {
//     readonly symbol: tsm.Symbol;
// }

// export type Resolver = (options: ProcessMethodOptions) => SymbolDef;

// export interface ObjectSymbolDef extends SymbolDef {
//     getProp(name: string): Resolver | undefined;
// }

// export interface FunctionSymbolDef extends ObjectSymbolDef {
//     parseCall(node: tsm.CallExpression, scope: ReadonlyScope): {
//         args: ParseExpressionResult, call: ParseExpressionResult };
// }

// export function isObjectDef(def: SymbolDef): def is ObjectSymbolDef {
//     return 'getProp' in def && typeof def.getProp === 'function';
// }

// export function isFunctionDef(def: SymbolDef): def is FunctionSymbolDef {
//     return isObjectDef(def) && 'parseCall' in def && typeof def.parseCall === 'function';
// }

// export function canResolve(def: SymbolDef): def is SymbolDef & Scope {
//     return 'resolve' in def && typeof def.resolve === 'function';
// }





// export function $resolve(map: ReadonlyMap<tsm.Symbol, SymbolDef>, symbol?: tsm.Symbol, parent?: ReadonlyScope) {
//     if (!symbol) { return undefined; }
//     else {
//         const def = map.get(symbol);
//         if (def) return def;

//         const valDeclSymbol = symbol.getValueDeclaration()?.getSymbol();
//         const valDeclDef = valDeclSymbol 
//             ? map.get(valDeclSymbol) 
//             : undefined
//         return valDeclDef ?? parent?.resolve();
//     }
// }

// function define(map: Map<tsm.Symbol, SymbolDef>, def: SymbolDef) {
//     if (map.has(def.symbol)) {
//         throw new Error(`${def.symbol.getName()} already defined in this scope`);
//     }
//     map.set(def.symbol, def);
// }



// const createScope = (parentScope?: ReadonlyScope) =>
//     (symbols: ReadonlyArray<SymbolDef>): ReadonlyScope => {
//         const map = new Map(symbols.map(def => [def.symbol, def]));
//         return {
//             parentScope,
//             symbols: map.values(),
//             resolve: (symbol) => $resolve(map, symbol, parentScope)
//         }
//     }

// export class GlobalScope implements Scope {
//     private readonly map = new Map<tsm.Symbol, SymbolDef>();
//     readonly parentScope = undefined;

//     get symbols(): IterableIterator<SymbolDef> {
//         return this.map.values();
//     }

//     resolve(symbol?: tsm.Symbol): SymbolDef | undefined {
//         return $resolve(this.map, symbol);
//     }

//     define<T extends SymbolDef>(def: T) {
//         return define(this.map, def);
//     }
// }

// // export function createGlobalScope(map: ReadonlyMap<tsm.Symbol, SymbolDef>): ReadonlyScope {
// //     return {
// //         parentScope: undefined,
// //         symbols: map.values(),
// //         resolve: (symbol) => resolve(map, symbol),
// //     }
// // }

// export function createBlockScope(node: tsm.Block, parentScope: ReadonlyScope): Scope {
//     const map = new Map<tsm.Symbol, SymbolDef>();

//     return {
//         parentScope,
//         symbols: map.values(),
//         resolve: (symbol) => $resolve(map, symbol, parentScope),
//         define: (def) => define(map, def),
//     }
// }

// export class MethodSymbolDef implements FunctionSymbolDef, ReadonlyScope {
//     private readonly map: ReadonlyMap<tsm.Symbol, SymbolDef>;

//     get parentScope() { return this.scope; }

//     constructor(
//         readonly symbol: tsm.Symbol,
//         readonly scope: ReadonlyScope,
//         readonly node: tsm.FunctionDeclaration,
//     ) {
//         const params = node.getParameters();
//         const map = new Map<tsm.Symbol, SymbolDef>();
//         for (let index = 0; index < params.length; index++) {
//             const param = params[index];
//             define(map, new VariableSymbolDef(param.getSymbolOrThrow(), 'arg', index));
//         }
//         this.map = map;
//     }

//     parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
//         const args = parseCallArguments(scope)(node);
//         const call = parseOK([{ kind: 'call', method: this } as CallOperation]);
//         return { call, args }
//     }

//     getProp(_name: string) { return undefined; }

//     get symbols(): IterableIterator<SymbolDef> {
//         return this.map.values();
//     }

//     resolve(symbol?: tsm.Symbol): SymbolDef | undefined {
//         return $resolve(this.map, symbol, this.scope);
//     }
// }


// export class ConstantSymbolDef implements SymbolDef {
//     constructor(
//         readonly symbol: tsm.Symbol,
//         readonly value: boolean | bigint | null | ReadonlyUint8Array
//     ) { }

//     loadOperations(): ParseExpressionResult {
//         if (this.value === null) {
//             return parseOK([{ kind: 'pushnull' }]);
//         }
//         if (this.value instanceof Uint8Array) {
//             return parseOK([{ kind: 'pushdata', value: this.value } as PushDataOperation]);
//         }
//         switch (typeof this.value) {
//             case 'boolean': {
//                 return parseOK([{ kind: 'pushbool', value: this.value } as PushBoolOperation]);
//             }
//             case 'bigint': {
//                 return parseOK([{ kind: 'pushint', value: this.value } as PushIntOperation]);
//             }
//             default:
//                 return parseError(`ConstantSymbolDef load ${this.value}`);
//         }
//     }
// }

// export class VariableSymbolDef implements SymbolDef {
//     constructor(
//         readonly symbol: tsm.Symbol,
//         readonly kind: 'arg' | 'local' | 'static',
//         readonly index: number
//     ) { }

//     loadOperations(): ParseExpressionResult {
//         const kind = this.kind === 'arg'
//             ? "loadarg"
//             : this.kind === 'local'
//                 ? 'loadlocal'
//                 : 'loadstatic';
//         return parseOK([{ kind, index: this.index } as LoadStoreOperation]);
//     }
// }

// export class EventSymbolDef implements FunctionSymbolDef {
//     constructor(
//         readonly symbol: tsm.Symbol,
//         readonly name: string,
//         readonly parameters: ReadonlyArray<tsm.ParameterDeclaration>,
//     ) { }

//     parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
//         // NCCS creates an empty array and then APPENDs each notification arg in turn
//         // However, APPEND is 4x more expensive than PACK and is called once per arg
//         // instead of once per Notify call as PACK is. 

//         const argNodes = node.getArguments() as tsm.Expression[];
//         const args = pipe(
//             argNodes, 
//             parseArguments(scope),
//             E.map(flow(
//                 ROA.concat([
//                     { kind: "pushint", value: BigInt(argNodes.length) },
//                     { kind: 'pack' },
//                     { kind: 'pushdata', value: Buffer.from(this.name, 'utf8') },
//                 ] as Operation[])
//             )))
//         const call = parseOK([{ kind: 'syscall', name: "System.Runtime.Notify" } as SysCallOperation]);
//         return { call, args }
//     }

//     getProp(_name: string) { return undefined; }
// }

// export class SysCallSymbolDef implements FunctionSymbolDef {
//     constructor(
//         readonly symbol: tsm.Symbol,
//         readonly name: string,
//     ) { }

//     parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
//         const args = parseCallArguments(scope)(node);
//         const call = parseOK([{ kind: 'syscall', name: this.name } as SysCallOperation]);
//         return { call, args }
//     }

//     getProp(_name: string) { return undefined; }
// }

// export class MethodTokenSymbolDef implements FunctionSymbolDef {
//     constructor(
//         readonly symbol: tsm.Symbol,
//         readonly token: sc.MethodToken
//     ) { }

//     parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
//         const args = parseCallArguments(scope)(node);
//         const call = parseOK([{ kind: 'calltoken', token: this.token } as CallTokenOperation]);
//         return { call, args }
//     }

//     getProp(_name: string) { return undefined; }
// }

// export class OperationsSymbolDef implements FunctionSymbolDef {
//     constructor(
//         readonly symbol: tsm.Symbol,
//         readonly operations: ReadonlyArray<Operation>
//     ) { }

//     parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
//         const args = parseCallArguments(scope)(node);
//         const call = parseOK(this.operations);
//         return { call, args }
//     }

//     getProp(_name: string) { return undefined; }
// }



































// interface ScopeOptions {
//     diagnostics: Array<tsm.ts.Diagnostic>;
//     scope: Scope,
//     symbol?: tsm.Symbol
// }

// const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\} ([_a-zA-Z0-9]+)/

// function parseMethodTokenTag(node: tsm.FunctionDeclaration, tag: tsm.JSDocTag) {
//     const matches = tag.getCommentText()?.match(regexMethodToken) ?? [];
//     if (matches.length !== 3) throw new CompileError("invalid method token tag comment", tag);
//     const hash = u.HexString.fromHex(matches[1], true);

//     // TODO: should we support specifying call flags in tag comment?
//     const callFlags = sc.CallFlags.All

//     return new sc.MethodToken({
//         hash: hash.toString(),
//         method: matches[2],
//         parametersCount: node.getParameters().length,
//         hasReturnValue: !isVoidLike(node.getReturnType()),
//         callFlags
//     })
// }

// const regexOperation = /(\S+)\s?(\S+)?/

// function parseOperationTags(node: tsm.FunctionDeclaration, tags: ReadonlyArray<tsm.JSDocTag>) {
//     const operations = new Array<Operation>();
//     for (const tag of tags) {
//         if (tag.getTagName() !== 'operation') {
//             throw new CompileError(`invalid operation tag`, node);
//         }
//         const comment = tag.getCommentText() ?? "";
//         const matches = comment.match(regexOperation) ?? [];
//         if (matches.length !== 3) throw new CompileError("invalid operation tag comment", tag);
//         const kind = matches[1];
//         const op = parseOperation(kind, matches[2])
//         if (!op) throw new Error(`Invalid operation kind ${kind}`);
//         operations.push(op);
//     }
//     return operations;
// }


// function processFunctionDeclaration(node: tsm.FunctionDeclaration, options: ScopeOptions) {
//     const symbol = options.symbol ?? node.getSymbolOrThrow();
//     const scope = options.scope;

//     if (node.hasDeclareKeyword()) {
//         const jsDocs = node.getJsDocs();
//         if (jsDocs.length !== 1) throw new CompileError(`declared functions must have a single JSDoc block tag`, node);
//         const jsTags = jsDocs[0].getTags();
//         const tag = jsTags[0];
//         if (!tag) throw new CompileError(`declared functions must have at least one JSDoc tag`, node);

//         switch (tag.getTagName()) {
//             case 'event': {
//                 if (jsTags.length !== 1) throw new CompileError('event functions must only have one JSDoc tag', node);
//                 if (!isVoidLike(node.getReturnType())) throw new CompileError('event functions cannot have return values', node);
//                 const eventName = tag.getCommentText() ?? symbol.getName();
//                 if (eventName.length === 0) throw new CompileError('invalid event tag', node);
//                 scope.define(new EventSymbolDef(symbol, eventName, node.getParameters()));
//                 return;
//             }
//             case 'methodToken': {
//                 if (jsTags.length !== 1) throw new CompileError('methodToken functions must only have one JSDoc tag', node);
//                 const token = parseMethodTokenTag(node, tag);
//                 scope.define(new MethodTokenSymbolDef(symbol, token));
//                 return;
//             }
//             case 'operation': {
//                 const operations = parseOperationTags(node, jsTags);
//                 scope.define(new OperationsSymbolDef(symbol, operations));
//                 return;
//             }
//             case 'syscall': {
//                 if (jsTags.length !== 1) throw new CompileError('syscall functions must only have one JSDoc tag', node);
//                 const serviceName = tag.getCommentText() ?? "";
//                 if (serviceName.length === 0) throw new CompileError('invalid syscall tag', node);
//                 scope.define(new SysCallSymbolDef(symbol, serviceName));
//                 return;
//             }
//             default:
//                 throw new CompileError(`invalid function declaration tag ${tag.getTagName()}`, node);
//         }

//         throw new CompileError("not supported", node);
//     } else {
//         scope.define(new MethodSymbolDef(symbol, scope, node));
//     }
// }

// function processImportSpecifier(node: tsm.ImportSpecifier, { diagnostics, scope }: ScopeOptions) {
//     const $module = node.getImportDeclaration().getModuleSpecifierSourceFileOrThrow();
//     const $moduleExports = $module.getExportedDeclarations();
//     const symbol = node.getSymbolOrThrow();
//     const name = (symbol.getAliasedSymbol() ?? symbol).getName();
//     const exportDecls = $moduleExports.get(name);
//     if (!exportDecls) {
//         diagnostics.push(createDiagnostic(`${name} import not found`, { node }));
//         return;
//     }
//     if (exportDecls.length !== 1) {
//         diagnostics.push(createDiagnostic(`multiple exported declarations not implemented`, { node }));
//         return;
//     }
//     for (const decl of exportDecls) {
//         processScopeNode(decl, { diagnostics, scope, symbol });
//     }
// }

// function processImportDeclaration(node: tsm.ImportDeclaration, { diagnostics, scope }: ScopeOptions) {
//     for (const $import of node.getNamedImports()) {
//         processImportSpecifier($import, { diagnostics, scope });
//     }
// }

// function processVariableDeclaration(node: tsm.VariableDeclaration, options: ScopeOptions) {
//     const declKind = node.getVariableStatementOrThrow().getDeclarationKind();
//     const symbol = options.symbol ?? node.getSymbolOrThrow();

//     if (declKind === tsm.VariableDeclarationKind.Const) {
//         const init = node.getInitializer();
//         if (!init) { throw new CompileError("missing initializer", node); }
//         const value = getConstantValue(init);
//         options.scope.define(new ConstantSymbolDef(symbol, value));
//     } else {
//         throw new CompileError(`not implemented`, node);
//     }
// }

// function processVariableStatement(node: tsm.VariableStatement, { diagnostics, scope }: ScopeOptions) {
//     for (const decl of node.getDeclarations()) {
//         processVariableDeclaration(decl, { diagnostics, scope });
//     }
// }

// function processInterfaceDeclaration(node: tsm.InterfaceDeclaration, { diagnostics, scope }: ScopeOptions) {
//     const stackItemTag = getJSDocTag(node, "stackitem");
//     if (stackItemTag) {

//     }
// }

// // function processEnumDeclaration(node: tsm.EnumDeclaration, options: ScopeOptions) {
// //     const members = node.getMembers();
// //     for (const member of members) {
// //         const value = member.getValue();
// //         console.log();
// //     }
// // }

// const scopeDispatchMap: NodeDispatchMap<ScopeOptions> = {
//     [tsm.SyntaxKind.FunctionDeclaration]: processFunctionDeclaration,
//     [tsm.SyntaxKind.InterfaceDeclaration]: processInterfaceDeclaration,
//     [tsm.SyntaxKind.ImportDeclaration]: processImportDeclaration,
//     [tsm.SyntaxKind.VariableDeclaration]: processVariableDeclaration,
//     [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
//     [tsm.SyntaxKind.EndOfFileToken]: () => { },
// };

// function processScopeNode(node: tsm.Node, options: ScopeOptions) {
//     dispatch(node, options, scopeDispatchMap);
// }

// interface Declarations {
//     functions: Array<tsm.FunctionDeclaration>,
//     interfaces: Array<tsm.InterfaceDeclaration>,
//     // typeAliases: Array<tsm.TypeAliasDeclaration>,
//     // modules: Array<tsm.ModuleDeclaration>,
//     variables: Array<tsm.VariableDeclaration>,
// }

// const LIB_PATH = `/node_modules/typescript/lib/`;

// // this code iterates thru the project's library declaration files. For now, we're just using ES2020,
// // though eventually we will likely want our own declaration file(s)
// function $getDeclarations(node: tsm.SourceFile | undefined, decls: Declarations, files?: Set<string>) {

//     if (!node) return;
//     if (!files) files = new Set<string>();

//     // ensure each library decalaration file is only processed once
//     const path = node.getFilePath();
//     if (files.has(path)) return;
//     files.add(path);

//     // Loop thru the declarations in this file, adding each to the appropriate declaration array
//     node.forEachChild(n => {
//         switch (n.getKind()) {
//             case tsm.SyntaxKind.FunctionDeclaration:
//                 decls.functions.push(n as tsm.FunctionDeclaration);
//                 break;
//             case tsm.SyntaxKind.InterfaceDeclaration:
//                 decls.interfaces.push(n as tsm.InterfaceDeclaration);
//                 break;
//             case tsm.SyntaxKind.TypeAliasDeclaration:
//                 // decls.typeAliases.push(n as tsm.TypeAliasDeclaration);
//                 break;
//             case tsm.SyntaxKind.ModuleDeclaration:
//                 // decls.modules.push(n as tsm.ModuleDeclaration);
//                 break;
//             case tsm.SyntaxKind.VariableStatement:
//                 decls.variables.push(...(n as tsm.VariableStatement).getDeclarations());
//                 break;
//             case tsm.SyntaxKind.EndOfFileToken:
//                 break;
//             default:
//                 throw new Error(`${n.getKindName()}`);
//         }
//     });

//     // loop thru the library references in the file and recursively call $getDeclarations
//     const prj = node.getProject();
//     for (const ref of node.getLibReferenceDirectives()) {
//         const path = LIB_PATH + `lib.${ref.getFileName()}.d.ts`;
//         $getDeclarations(prj.getSourceFile(path), decls, files);
//     }
// }

// function getDeclarations(project: tsm.Project) {
//     const decls = {
//         functions: new Array<tsm.FunctionDeclaration>(),
//         interfaces: new Array<tsm.InterfaceDeclaration>(),
//         variables: new Array<tsm.VariableDeclaration>(),
//     };

//     // call $getDeclarations for each top level library declaration file in the project
//     const libs = project.compilerOptions.get().lib ?? [];
//     for (const lib of libs) {
//         const src = project.getSourceFile(LIB_PATH + lib);
//         $getDeclarations(src, decls);
//     }

//     // create a map of strings to the declaration's symbol
//     const variables = new Map(from(decls.variables).pipe(
//         map(x => [x.getSymbolOrThrow().getName(), x] as [string, tsm.VariableDeclaration]),
//         orderBy(x => x[0])
//     ));

//     // const functions = new Map(from(decls.functions).pipe(
//     //     map(x => x.getSymbolOrThrow()),
//     //     orderBy(x => x.getName()),
//     //     map(x => [x.getName(), x])));
//     // // note, interfaces can have multiple declarations which are merged 
//     // // each declaration has a unique symbol, but the interface Type and type's symbol) is
//     // // shared across all the declarations. So for interfaces, first create a set of type symbols
//     // // to weed out duplicates, then create a string -> symbol map from the set values
//     // const interfaceSet = new Set(from(decls.interfaces).pipe(map(x => x.getType().getSymbolOrThrow())));
//     // const interfaces = new Map(from(interfaceSet.values()).pipe(
//     //     orderBy(x => x.getName()),
//     //     map(x => [x.getName(), x])));

//     return { variables };
// }



// export function createSymbolTrees({ project, diagnostics, scopes }: CompileContext): void {

//     const q = parseProject(project);

//     const { variables } = getDeclarations(project);
//     for (const src of project.getSourceFiles()) {
//         if (src.isDeclarationFile()) continue;
//         const scope = new GlobalScope();
//         // defineErrorObj(scope, variables);
//         // defineUint8ArrayObj(scope, variables);

//         src.forEachChild(node => processScopeNode(node, { diagnostics, scope }));
//         scopes.push(scope);
//     }
// }


// function parseFunctionDeclaration(node: tsm.FunctionDeclaration) {

// }

// // function processVariableDeclaration(node: tsm.VariableDeclaration, options: ScopeOptions) {
// //     const declKind = node.getVariableStatementOrThrow().getDeclarationKind();
// //     const symbol = options.symbol ?? node.getSymbolOrThrow();

// //     if (declKind === tsm.VariableDeclarationKind.Const) {
// //         const init = node.getInitializer();
// //         if (!init) { throw new CompileError("missing initializer", node); }
// //         const value = getConstantValue(init);
// //         options.scope.define(new ConstantSymbolDef(symbol, value));
// //     } else {
// //         throw new CompileError(`not implemented`, node);
// //     }
// // }

// // function processVariableStatement(node: tsm.VariableStatement, { diagnostics, scope }: ScopeOptions) {
// //     for (const decl of node.getDeclarations()) {
// //         processVariableDeclaration(decl, { diagnostics, scope });
// //     }
// // }


