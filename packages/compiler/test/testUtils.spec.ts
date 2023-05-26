import { expect } from 'chai';
import * as tsm from 'ts-morph';
import { identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as S from 'fp-ts/State';
import * as E from 'fp-ts/Either';
import { createContractProject, isArray } from '../src/utils';
import { collectProjectDeclarations } from '../src/passes/collectProjectDeclarations';
import { parseExpression } from '../src/passes/expressionProcessor';
import { CompileTimeObject, CompileTimeType, PropertyResolver, Scope, createEmptyScope, updateScope } from '../src/types/CompileTimeObject';
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

interface CreateTestVariableOptions {
    name?: string;
    symbol?: tsm.Symbol;
    properties?: ReadonlyMap<string, PropertyResolver>;
}

export function createTestVariable(node: tsm.Node, options?: CreateTestVariableOptions) {
    const symbol = options?.symbol ?? node.getSymbolOrThrow();
    const name = options?.name ?? (tsm.Node.hasName(node) ? node.getName() : symbol.getName());
    const loadOp = { kind: 'noop', debug: `${name}.load` } as Operation;
    const storeOp = { kind: 'noop', debug: `${name}.store` } as Operation;
    return { node, symbol, loadOp, storeOp, loadOps: [loadOp], storeOps: [storeOp], properties: options?.properties };
}

export function expectPushData(op: Operation, value: string) {
    expect(op).has.property('kind', 'pushdata');
    expect(op).has.deep.property('value', Buffer.from(value, 'utf8'));
}

export function createPropResolver(cto: CompileTimeObject): PropertyResolver {
    return (opsFunc) => pipe(
        opsFunc(),
        E.map(ops => {
            const loadOps = ROA.concat(cto.loadOps)(ops);
            const storeOps = cto.storeOps ? ROA.concat(cto.storeOps)(ops) : undefined;
            return { ...cto, loadOps, storeOps, } as CompileTimeObject;
        })
    );
}

export function createPropResolvers(properties: CompileTimeObject | readonly CompileTimeObject[]): ReadonlyMap<string, PropertyResolver> {
    properties = isArray(properties) ? properties : ROA.of(properties);
    return new Map(properties.map(cto => [cto.symbol.getName(), createPropResolver(cto)]));
}