import * as tsm from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import * as S from 'fp-ts/State';
import { Operation } from "./Operation";
import { DebugInfo } from "./DebugInfo";

export interface CompileOptions {
    readonly addressVersion: number;
    readonly inline: boolean;
    readonly optimize: boolean;
    readonly standards: ReadonlyArray<string>;
}

export interface ContractSlot {
    name: string; 
    type: tsm.Type
}
export interface ContractMethod {
    symbol: tsm.Symbol;
    node: tsm.FunctionDeclaration;
    operations: readonly Operation[];
    variables: readonly ContractSlot[];
}

export interface ContractEvent {
    symbol: tsm.Symbol;
    node: tsm.FunctionDeclaration;
}

export interface CompiledProject {
    readonly methods: readonly ContractMethod[];
    readonly events: readonly ContractEvent[];
    readonly staticVars: readonly ContractSlot[];
}

export interface CompiledProjectArtifacts {
    readonly nef: sc.NEF;
    readonly manifest: sc.ContractManifest;
    readonly debugInfo: DebugInfo;
}

export interface CompileArtifacts {
    readonly diagnostics: ReadonlyArray<tsm.ts.Diagnostic>;
    readonly compiledProject?: CompiledProject;
    readonly nef?: sc.NEF;
    readonly manifest?: sc.ContractManifest;
    readonly debugInfo?: DebugInfo;
}

export interface CompileContext {
    readonly diagnostics: Array<tsm.ts.Diagnostic>;
    readonly options: Readonly<Required<CompileOptions>>;
    readonly project: tsm.Project;
}

export type CompilerState<T> = S.State<readonly tsm.ts.Diagnostic[], T>;
