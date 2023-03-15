import * as tsm from "ts-morph";
import { PathLike, accessSync } from 'fs';
import * as ROA from 'fp-ts/ReadonlyArray'


import { parseProjectLibrary } from "./projectLib";
import { collectArtifacts } from "./collectArtifacts";
import { makeGlobalScope } from "./passes/builtins";
import { parseProject } from "./passes/sourceFileProcessor";
import { CompileOptions, CompileArtifacts } from "./types/CompileOptions";

export const DEFAULT_ADDRESS_VALUE = 53;


function hasErrors(diagnostics: ReadonlyArray<tsm.ts.Diagnostic>) {
    return diagnostics.some(d => d.category === tsm.ts.DiagnosticCategory.Error);
}

export function compile(
    project: tsm.Project,
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

