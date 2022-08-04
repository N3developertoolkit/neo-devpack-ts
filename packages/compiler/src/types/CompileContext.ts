import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { DebugMethodInfo } from "./DebugInfo";
import { Immutable } from "../utility/Immutable";
import { Instruction } from "./Instruction";

export type DefineSymbolFunction<T extends SymbolDefinition> = (scope: NeoScope) => T;

export interface NeoScope {
    readonly name: string;
    readonly enclosingScope: NeoScope | undefined;
    getSymbols(): IterableIterator<SymbolDefinition>;
    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>): T;
    resolve(symbol: tsm.Symbol): SymbolDefinition | undefined;
}

export interface SymbolDefinition {
    readonly symbol: tsm.Symbol;
    readonly scope: NeoScope;
}

export interface CompileOptions {
    project: tsm.Project;
    addressVersion?: number;
    inline?: boolean;
    optimize?: boolean;
}

export interface CompileContext {
    readonly project: tsm.Project,
    readonly options: Readonly<Pick<CompileOptions, 'addressVersion' | 'inline' | 'optimize'>>
    readonly globals: NeoScope,
    readonly diagnostics: Array<tsm.ts.Diagnostic>,
    
    name?: string,

    operations?: Array<OperationInfo>,
    staticFields?: Array<StaticField>,
    artifacts?: CompileArtifacts
}


export interface CompileResults {
    readonly diagnostics: ReadonlyArray<tsm.ts.Diagnostic>,
    readonly artifacts?: Immutable<CompileArtifacts>,
    readonly context: Immutable<Omit<CompileContext, 'diagnostics' | 'artifacts'>>
}

export interface CompileArtifacts {
    nef: sc.NEF,
    manifest: sc.ContractManifest,
    methods: Array<DebugMethodInfo>
}

export interface OperationInfo {
    readonly node: tsm.FunctionDeclaration,
    name: string,
    isPublic: boolean,
    safe: boolean,
    parameters: Array<ParameterInfo>,
    returnType: tsm.Type,
    instructions?: Array<Instruction | tsm.Node>,
}

export interface ParameterInfo {
    readonly node: tsm.ParameterDeclaration,
    name: string,
    index: number,
    type: tsm.Type,
}

export interface StaticField { }
