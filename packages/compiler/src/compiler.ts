import { sc } from "@cityofzion/neon-core";
import { Node, Symbol, FunctionDeclaration, Type, ts, Project } from "ts-morph";
import { PathLike, accessSync } from 'fs';
import { parseProjectLibrary } from "./projectLib";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import { Operation } from "./types/Operation";
import { DebugInfo } from "./types/DebugInfo";
import { collectArtifacts } from "./collectArtifacts";
import { makeGlobalScope } from "./passes/builtins";
import { parseProject } from "./passes/sourceFileProcessor";

export const DEFAULT_ADDRESS_VALUE = 53;

export class CompileError extends Error {
    constructor(
        message: string,
        public readonly node: Node
    ) {
        super(message);
    }
}

export interface CompileOptions {
    readonly addressVersion: number;
    readonly inline: boolean;
    readonly optimize: boolean;
    readonly standards: ReadonlyArray<string>;
}

export interface ContractMethod {
    symbol: Symbol,
    node: FunctionDeclaration,
    operations: ReadonlyArray<Operation>,
    variables: ReadonlyArray<{ name: string, type: Type }>,
}

export interface CompileArtifacts {
    readonly diagnostics: ReadonlyArray<ts.Diagnostic>;
    readonly methods?: ReadonlyArray<ContractMethod>;
    readonly nef?: sc.NEF;
    readonly manifest?: sc.ContractManifest;
    readonly debugInfo?: DebugInfo;
}

export interface CompileContext {
    readonly diagnostics: Array<ts.Diagnostic>;
    readonly options: Readonly<Required<CompileOptions>>;
    readonly project: Project;
}

export type CompilerState<T> = S.State<ReadonlyArray<ts.Diagnostic>, T>;

function hasErrors(diagnostics: ReadonlyArray<ts.Diagnostic>) {
    return diagnostics.some(d => d.category === ts.DiagnosticCategory.Error);
}

export function compile(
    project: Project,
    contractName: string,
    options?: Partial<CompileOptions>
): CompileArtifacts {

    const $options: CompileOptions = {
        addressVersion: options?.addressVersion ?? DEFAULT_ADDRESS_VALUE,
        inline: options?.inline ?? false,
        optimize: options?.optimize ?? false,
        standards: options?.standards ?? [],
    }

    let [library, diagnostics] = parseProjectLibrary(project)(ROA.empty);
    if (hasErrors(diagnostics)) { return { diagnostics } }

    let globalScope;
    [globalScope, diagnostics] = makeGlobalScope(library)(diagnostics);
    if (hasErrors(diagnostics)) { return { diagnostics } }
    
    let methods;
    [methods, diagnostics] = parseProject(globalScope)(project)(diagnostics);
    if (hasErrors(diagnostics)) { return { diagnostics } }

    let artifacts;
    [artifacts, diagnostics] = collectArtifacts(contractName, methods, $options)(diagnostics);
    if (hasErrors(diagnostics)) { return { diagnostics } }

    return { diagnostics, methods, ...artifacts };
}

function exists(rootPath: PathLike) {
    try {
        accessSync(rootPath);
        return true;
    } catch {
        return false;
    }
}

