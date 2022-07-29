import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { DebugMethodInfo } from "./DebugInfo";
import { Immutable } from "../utility/Immutable";
import { Builtins } from "../passes/resolveBuiltins";
import { Instruction } from "./Instruction";

export interface CompileContext {
    readonly project: tsm.Project,
    readonly declarationFiles: ReadonlyArray<tsm.SourceFile>,
    readonly options: Readonly<Pick<CompileOptions, 'addressVersion' | 'inline' | 'optimize'>>
    name?: string,
    builtins?: Builtins,
    operations?: Array<OperationInfo>,
    staticFields?: Array<StaticField>,
    diagnostics: Array<tsm.ts.Diagnostic>,
    artifacts?: CompileArtifacts
}

export interface CompileOptions {
    project: tsm.Project;
    declarationFiles: Array<tsm.SourceFile>;
    addressVersion?: number;
    inline?: boolean;
    optimize?: boolean;
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
