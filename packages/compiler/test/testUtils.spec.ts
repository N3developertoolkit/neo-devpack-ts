import { expect } from 'chai';
import * as tsm from 'ts-morph';
import { identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as S from 'fp-ts/State';
import * as E from 'fp-ts/Either';
import { ParseError, createContractProject, isArray } from '../src/utils';
import { collectProjectDeclarations } from '../src/collectProjectDeclarations';
import { parseExpression } from '../src/passes/expressionProcessor';
import { CompileTimeObject, CompileTimeType, InvokeResolver, PropertyResolver, Scope, createEmptyScope, updateScope } from '../src/types/CompileTimeObject';
import { Operation, pushInt, pushString } from '../src/types/Operation';
import { makeGlobalScope } from '../src/builtin'
import { adaptStatement } from '../src/passes/functionProcessor';

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
    loadOps?: readonly Operation[];
    storeOps?: readonly Operation[];
    call?: InvokeResolver;
    callNew?: InvokeResolver;
}

export function createTestVariable(node: tsm.Node, options?: CreateTestVariableOptions) {
    const symbol = options?.symbol ?? node.getSymbolOrThrow();
    const name = options?.name ?? (tsm.Node.hasName(node) ? node.getName() : symbol.getName());
    const loadOp = { kind: 'noop', debug: `${name}.load` } as Operation;
    const storeOp = { kind: 'noop', debug: `${name}.store` } as Operation;
    const loadOps = options?.loadOps ?? (options?.call || options?.callNew ? [] : [loadOp]);
    const storeOps = options?.storeOps ?? (options?.call || options?.callNew ? undefined : [storeOp]);
    const call = options?.call ? () => options.call! : undefined;
    const callNew = options?.callNew ? () => options.callNew! : undefined;
    return {
        node,
        symbol,
        loadOp,
        storeOp,
        loadOps,
        storeOps,
        properties: options?.properties,
        call,
        callNew,
    };
}

export function expectPushData(op: Operation, value: string | Uint8Array) {
    value = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    expect(op).has.property('kind', 'pushdata');
    expect(op).has.deep.property('value', value);
}

export function expectPushInt(op: Operation, value: number | bigint) {
    value = typeof value === 'bigint' ? value : BigInt(value);
    expect(op).has.property('kind', 'pushint');
    expect(op).has.deep.property('value', value);
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
    return pipe(
        properties,
        ROA.filter(cto => !!cto.symbol),
        ROA.map(cto => [cto.symbol!.getName(), createPropResolver(cto)] as const),
        entries => new Map(entries),
        ROM.fromMap,
    )
}

export function makeFunctionInvoker(node: tsm.Node, ops: Operation | readonly Operation[], implicitThis: boolean = false): InvokeResolver {
    return ($this, args) => {
        const $args = implicitThis ? ROA.prepend($this)(args) : args;
        return pipe(
            $args,
            ROA.reverse,
            ROA.map(arg => arg()),
            ROA.sequence(E.Applicative),
            E.map(ROA.flatten),
            E.map(ROA.concat(isArray(ops) ? ops : [ops])),
            E.map(loadOps => (<CompileTimeObject>{
                node: node,
                symbol: node.getSymbolOrThrow(),
                loadOps
            }))
        );
    }
}

export function expectEither<T>(value: E.Either<ParseError | readonly ParseError[], T>): T {
    return pipe(
        value,
        E.match(
            err => {
                if (isArray(err)) {
                    expect.fail(err.map(e => e.message).join(", "));
                } else {
                    expect.fail(err.message);
                }
            },
            value => value
        )
    );
}

export function expectResults(ops: readonly Operation[], ...args: any[]) {
    for (const i in args) {
        if (args[i].skip) continue
        if (args[i].$kind) {
            expect(ops[i]).has.property('kind', args[i].$kind);
            continue;
        }
        if (ops[i] === args[i]) continue;
        expect(ops[i]).deep.equals(args[i], `operation ${i} not equal`);
    }
    expect(ops).length(args.length);
}

export function expectResultsNoLengthCheck(ops: readonly Operation[], ...args: any[]) {
    for (const i in args) {
        if (args[i].skip) continue
        expect(ops[i]).deep.equals(args[i], `operation ${i} not equal`);
    }
}

export function makeTarget(debug?: string) {
    return { kind: 'noop', debug } as Operation;
}

export function findDebug(ops: readonly Operation[], debug: string) {
    return ops.find(op => (op as any).debug === debug);
}

export function createVarDeclCTO(src: tsm.SourceFile, name: string): CompileTimeObject & { loadOp: Operation, storeOp: Operation } {
    const variable = src.getVariableDeclarationOrThrow(name);
    return createTestVariable(variable);
}

export function createLiteralCTO(arg: tsm.Node, value?: string | number | bigint | boolean): CompileTimeObject & { loadOp: Operation } {
    const loadOp = value === undefined
        ? <Operation>{ kind: "pushnull" }
        : typeof value === "string"
            ? pushString(value)
            : typeof value === "number" || typeof value === "bigint"
                ? pushInt(value)
                : <Operation>{ kind: "pushbool", value }

    return {
        node: arg,
        loadOp,
        loadOps: [loadOp]
    };
}

export function testAdaptStatement(scope: Scope, node: tsm.Statement) {
    const returnTarget = { kind: 'noop', debug: 'returnTarget' } as Operation;

    const [ops, context] = adaptStatement(node)({
        scope,
        returnTarget,
        environStack: [],
        errors: [],
        locals: [],
    });
    if (context.errors.length > 0) {
        if (context.errors.length === 1) {
            expect.fail(context.errors[0].message);
        } else {
            const msg = context.errors.map(e => e.message).join('\n');
            expect.fail(msg);
        }
    }
    return { ops, context }

}