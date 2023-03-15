import { assert, expect } from 'chai';
import 'mocha';

import * as tsm from 'ts-morph'
import { pipe } from 'fp-ts/lib/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as S from 'fp-ts/State';

import { createContractProject } from './utils';
import { parseProjectLibrary } from './projectLib';
import { makeGlobalScope } from './passes/builtins';

export function testRight<E, A>(value: E.Either<E, A>) {
    if (E.isRight(value))
        return value.right;
    assert.fail("Either value is left");
}

export function createTestProject(contract: string) {
    const project = createContractProject();
    const sourceFile = project.createSourceFile("contract.ts", contract);
    project.resolveSourceFileDependencies();

    let [scope, diagnostics] = pipe(
        project.getPreEmitDiagnostics(),
        ROA.map(d => d.compilerObject),
        pipe(
            parseProjectLibrary(project),
            S.chain(makeGlobalScope)
        )
    );

    const errors = diagnostics.filter(d => d.category === tsm.ts.DiagnosticCategory.Error);
    expect(errors).lengthOf(0);
    
    return { project, sourceFile, scope }
}

export const bufferEquals =
    (hex: string) =>
        (value: Uint8Array) =>
            Buffer.from(hex, 'hex').compare(value) === 0;