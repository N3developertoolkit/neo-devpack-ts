// import { assert, expect } from 'chai';
// import 'mocha';

// import * as tsm from 'ts-morph'
// import { identity, pipe } from 'fp-ts/lib/function';
// import * as ROA from 'fp-ts/ReadonlyArray';
// import * as E from "fp-ts/Either";
// import * as S from 'fp-ts/State';

// import { createContractProject } from './utils';
// import { makeGlobalScope } from './passes/builtins';
// import { Scope, SymbolDef, TypeDef } from './types/ScopeType';
// import { createScope } from './scope';
// import { Operation } from './types/Operation';
// import { collectProjectDeclarations } from './projectLib';

// export const testRight = <E, A>(func?: (left: E) => string) => (value: E.Either<E, A>) => {
//     if (E.isRight(value)) return value.right;
//     assert.fail(func ? func(value.left) : "left Either value")
// }

// export function createTestProject(contract: string) {
//     const project = createContractProject();
//     const sourceFile = project.createSourceFile("contract.ts", contract);
//     project.resolveSourceFileDependencies();

//     let [globalScope, diagnostics] = pipe(
//         project.getPreEmitDiagnostics(),
//         ROA.map(d => d.compilerObject),
//         pipe(
//             collectProjectDeclarations(project),
//             S.chain(makeGlobalScope)
//         )
//     );

//     const errors = diagnostics.filter(d => d.category === tsm.ts.DiagnosticCategory.Error);
//     if (errors.length > 0) {
//         expect.fail(errors.map(d => d.messageText).join(","));
//     }
    
//     return { project, sourceFile, globalScope }
// }

// export const makeTestScope = (parentScope?: Scope) =>
//     (defs: readonly SymbolDef[], types: readonly TypeDef[] = []): Scope => {
//         return pipe(
//             createScope(parentScope)(defs, types),
//             E.match(expect.fail, identity)
//         );
//     }

// export const createTestScope = (scope: Scope) => (nodes: tsm.Node | tsm.Node[]) => {
//     const defs = (Array.isArray(nodes) ? nodes : [nodes]).map((v, i) => {
//         const symbol = v.getSymbolOrThrow();
//         return {
//             symbol,
//             type: v.getType(),
//             loadOps:
//                 [{
//                     kind: "loadlocal",
//                     index: i,
//                     debug: symbol.getName(),
//                 } as Operation]
//         } as SymbolDef;
//     })
//     return makeTestScope(scope)(defs);
// }


// export const bufferEquals =
//     (hex: string) =>
//         (value: Uint8Array) =>
//             Buffer.from(hex, 'hex').compare(value) === 0;