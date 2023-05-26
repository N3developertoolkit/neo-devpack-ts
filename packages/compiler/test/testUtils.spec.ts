import { expect } from 'chai';
import * as tsm from 'ts-morph';
import { identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as S from 'fp-ts/State';
import * as E from 'fp-ts/Either';
import { createContractProject } from '../src/utils';
import { collectProjectDeclarations } from '../src/passes/collectProjectDeclarations';
import { parseExpression } from '../src/passes/expressionProcessor';
import { CompileTimeObject, CompileTimeType, Scope, createEmptyScope, updateScope } from '../src/types/CompileTimeObject';
import { Operation } from '../src/types/Operation';
import { makeGlobalScope } from '../src/builtin'

// import { CompileTimeObject, createEmptyScope, makeCompileTimeObject, updateScope } from '../src/types/CompileTimeObject';
// import { Operation } from '../src/types/Operation';
export function createTestProject(contract: string) {
    const project = createContractProject();
    const sourceFile = project.createSourceFile("contract.ts", contract);
    project.resolveSourceFileDependencies();

    const errors = project.getPreEmitDiagnostics()
        .map(d => d.compilerObject)
        .filter(d => d.category === tsm.ts.DiagnosticCategory.Error);
    if (errors.length > 0) { expect.fail(errors.map(d => d.messageText).join(", ")); }

    return { project, sourceFile };
}

export function createTestGlobalScope(project: tsm.Project) {

    const [globalScope, diagnostics] = pipe(
        project.getPreEmitDiagnostics(),
        ROA.map(d => d.compilerObject),
        pipe(
            collectProjectDeclarations(project),
            S.chain(makeGlobalScope)
        )
    );

    if (diagnostics.length > 0) {
        expect.fail(diagnostics.map(d => d.messageText).join(", "));
    }

    return globalScope;
}

export function createTestScope(
    parentScope?: Scope,
    symbols?: CompileTimeObject | readonly CompileTimeObject[],
    types?: CompileTimeType | readonly CompileTimeType[]
) {
    const scope = createEmptyScope(parentScope);
    return updateScope(scope)(symbols, types);
}

export function testParseExpression(node: tsm.Expression, scope?: Scope) {
    scope ??= createEmptyScope();

    return pipe(
        node,
        parseExpression(scope),
        E.match(
            error => expect.fail(error.message),
            identity
        )
    );
}

export function createTestVariable(node: tsm.VariableDeclaration) {
    const symbol = node.getSymbolOrThrow();
    const loadOp = { kind: 'noop', debug: `${node.getName()}.load` } as Operation;
    const storeOp = { kind: 'noop', debug: `${node.getName()}.store` } as Operation;
    return { node, symbol, loadOp, storeOp, loadOps: [loadOp], storeOps: [storeOp] };
}

export function expectPushData(op: Operation, value: string) {
    expect(op).has.property('kind', 'pushdata');
    expect(op).has.deep.property('value', Buffer.from(value, 'utf8'));
}