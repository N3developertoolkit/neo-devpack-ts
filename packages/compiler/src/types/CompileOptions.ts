import * as tsm from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { Location, Operation } from "./Operation";

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
    readonly diagnostics: readonly tsm.ts.Diagnostic[];
    readonly compiledProject?: CompiledProject;
    readonly nef?: sc.NEF;
    readonly manifest?: sc.ContractManifest;
    readonly debugInfo?: DebugInfo;
}

export interface SequencePoint {
    address: number;
    location: Location,
}

export interface DebugInfoEvent {
    readonly id: string;
    readonly name: string;
    readonly params?: readonly string[];
}

export interface DebugInfoMethod {
    readonly id: string;
    readonly name: string;
    // range format: "{start-address}-{end-address}
    readonly range: string;
    readonly params?: readonly string[];
    readonly "return"?: string;
    readonly variables?: readonly string[];
    // sequence point format: "{address}[{document-index}]{start-line}:{start-column}-{end-line}:{end-column}"
    readonly "sequence-points"?: readonly string[];
}

export interface DebugInfo {
    readonly hash: string; // hex-encoded UInt160
    readonly documents?: readonly string[]; // file paths
    readonly "document-root"?: string;
    readonly events?: readonly DebugInfoEvent[];
    readonly methods?: readonly DebugInfoMethod[];
    readonly "static-variables"?: readonly string[];
}
