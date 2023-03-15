import * as tsm from "ts-morph";
import { PathLike, accessSync } from 'fs';
import { pipe } from "fp-ts/lib/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'

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

    let [{ methods, artifacts }, diagnostics] = pipe(
        project.getPreEmitDiagnostics(),
        ROA.map(d => d.compilerObject),
        pipe(
            parseProjectLibrary(project),
            S.chain(makeGlobalScope),
            S.chain(parseProject(project)),
            S.bindTo('methods'),
            S.bind('artifacts', ({ methods }) => collectArtifacts(contractName, $options)(methods))
        )
    );

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

