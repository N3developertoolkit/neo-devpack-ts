import * as tsm from "ts-morph";
import { PathLike, accessSync } from 'fs';
import { pipe } from "fp-ts/lib/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'

import { collectProjectDeclarations } from "./passes2/collectProjectDeclarations";
import { collectArtifacts } from "./passes2/collectArtifacts";
import { makeGlobalScope } from "./passes/builtins";
import { parseProject } from "./passes/sourceFileProcessor";
import { CompileOptions, CompileArtifacts } from "./types/CompileOptions";

export const DEFAULT_ADDRESS_VALUE = 53;

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

    let [{ compiledProject, artifacts }, diagnostics] = pipe(
        project.getPreEmitDiagnostics(),
        ROA.map(d => d.compilerObject),
        pipe(
            collectProjectDeclarations(project),
            S.chain(makeGlobalScope),
            S.chain(parseProject(project)),
            S.bindTo('compiledProject'),
            S.bind('artifacts', ({ compiledProject }) => collectArtifacts(contractName, $options)(compiledProject))
        ),
    );

    return { diagnostics, compiledProject, ...artifacts };
}

function exists(rootPath: PathLike) {
    try {
        accessSync(rootPath);
        return true;
    } catch {
        return false;
    }
}

