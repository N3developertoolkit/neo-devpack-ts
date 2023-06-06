import * as tsm from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { Operation } from "./Operation";
import type { DebugInfo } from "./DebugInfo";

export interface CompileOptions {
    readonly addressVersion: number;
    readonly inline: boolean;
    readonly optimize: boolean;
    readonly standards: ReadonlyArray<string>;
}

export interface ContractVariable {
    name: string;
    type: tsm.Type;
    index: number;
}

export interface ContractMethod {
    symbol: tsm.Symbol;
    node: tsm.FunctionDeclaration;
    operations: readonly Operation[];
    variables: readonly ContractVariable[];
}

export interface ContractEvent {
    symbol: tsm.Symbol;
    node: tsm.FunctionDeclaration;
}

export interface CompiledProject {
    readonly methods: readonly ContractMethod[];
    readonly events: readonly ContractEvent[];
    readonly staticVars: readonly ContractVariable[];
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
