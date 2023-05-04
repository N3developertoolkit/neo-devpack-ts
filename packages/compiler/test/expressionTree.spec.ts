// import 'mocha';
// import { assert, expect } from 'chai';

// import * as tsm from 'ts-morph'
// import { identity, pipe } from 'fp-ts/lib/function';
// import * as ROA from 'fp-ts/ReadonlyArray';
// import * as E from "fp-ts/Either";
// import * as S from 'fp-ts/State';
// import * as O from 'fp-ts/Option';

// import { ParseError, createContractProject } from '../src/utils';
// import { collectProjectDeclarations } from '../src/passes/collectProjectDeclarations';
// import { makeGlobalScope, makeStackItemType } from '../src/passes/builtins';
// import { loadTree, parseExpressionTree, resolveTree } from '../src/passes/expressionResolver';
// import { CompileTimeObject, createEmptyScope, makeCompileTimeObject, updateScope } from '../src/types/CompileTimeObject';
// import { Operation } from '../src/types/Operation';

// export function createTestProject(contract: string) {
//     const project = createContractProject();
//     const sourceFile = project.createSourceFile("contract.ts", contract);
//     project.resolveSourceFileDependencies();

//     const errors = project.getPreEmitDiagnostics()
//         .map(d => d.compilerObject)
//         .filter(d => d.category === tsm.ts.DiagnosticCategory.Error);
//     if (errors.length > 0) { expect.fail(errors.map(d => d.messageText).join(", ")); }

//     return { project, sourceFile };
// }

// export function createTestScope(symbols?: CompileTimeObject | readonly CompileTimeObject[], types?: CompileTimeObject | readonly CompileTimeObject[]) {
//     return pipe(
//         updateScope(createEmptyScope())(symbols, types),
//         E_fail
//     );
// }

// export function findSymbol(name: string, node: tsm.Node, flags: tsm.ts.SymbolFlags) {
//     const symbol = node.getSymbolsInScope(flags).find(s => s.getName() === name);
//     if (!symbol) expect.fail(`Symbol ${name} not found`);
//     return symbol;
// }

// export function findProperty(name: string, symbol: tsm.Symbol) {
//     const props = symbol.getDeclarations().flatMap(d => d.getType().getProperties());
//     const prop = props.find(p => p.getName() === name);
//     if (!prop) expect.fail(`Property ${name} not found`);
//     return prop;
// }

// export function E_fail<T>(value: E.Either<string | ParseError, T>): T {
//     if (E.isLeft(value)) {
//         const message = typeof value.left  === 'string' ? value.left : value.left.message;
//         expect.fail(message);
//     } else {
//         return value.right;
//     }
// }

// describe("built-ins", () => {
//     it("@stackItem", () => {
//         const contract = /*javascript*/`
//             function testFunc() {
//                 const tx = Runtime.scriptContainer as Transaction;
//                 const currentHash = tx.sender;
//             }`;

//             const { sourceFile } = createTestProject(contract);
//             const symbolTXtype = findSymbol("Transaction", sourceFile, tsm.ts.SymbolFlags.Interface);
//             const declTXtype = symbolTXtype.getDeclarations()[0].asKindOrThrow(tsm.SyntaxKind.InterfaceDeclaration);
//             const ctoTXtype = makeStackItemType(declTXtype);

//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const symbolTX = findSymbol("tx", func, tsm.ts.SymbolFlags.Variable);
//             const decltx = symbolTX.getValueDeclarationOrThrow();
//             const ctoTX = makeCompileTimeObject(decltx, symbolTX, { loadOps: [{ kind: 'noop', debug: 'tx' } as Operation] });

//             const scope = createTestScope(ctoTX, ctoTXtype);

//             const decl = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[1];
//             const init = decl.getInitializerOrThrow();

//             const tree = parseExpressionTree(init);
//             const resolved = pipe(
//                 tree,
//                 E.chain(loadTree(scope)),
//                 E.match(error => expect.fail(error.message), identity)
//             )
    
//     })
// });

// describe("expression trees", () => {

    
//     it("load identifier", () => {
//         const contract = /*javascript*/`function testFunc() { const runtime = Runtime }`;

//         const { sourceFile } = createTestProject(contract);

//         const runtime = findSymbol("Runtime", sourceFile, tsm.ts.SymbolFlags.Variable);
//         const cto: CompileTimeObject = {
//             node: runtime.getValueDeclarationOrThrow(),
//             symbol: runtime,
//             loadOps: [ { kind: 'noop', debug: 'Runtime' } as Operation],
//         }
//         const scope = createTestScope(cto);

//         const func = sourceFile.getFunctionOrThrow('testFunc');
//         const decl = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0];
//         const init = decl.getInitializerIfKindOrThrow(tsm.SyntaxKind.Identifier);

//         const resolved = pipe(
//             init,
//             parseExpressionTree,
//             E.chain(loadTree(scope)),
//             E_fail
//         )

//         expect(resolved).to.equal(cto.loadOps!);
//     });

//     it("load identifier.property", () => {
//         const contract = /*javascript*/`function testFunc() { const platform = Runtime.platform }`;

//         const { sourceFile } = createTestProject(contract);

//         const runtimeCtor = findSymbol("RuntimeConstructor", sourceFile, tsm.ts.SymbolFlags.Interface);
//         const platform = findProperty("platform", runtimeCtor);
//         const platformCTO: CompileTimeObject = {
//             node: platform.getValueDeclarationOrThrow(),
//             symbol: platform,
//             loadOps: [ { kind: 'noop', debug: 'RuntimeConstructor.platform' } as Operation],
//         }

//         const runtimeCtorCTO: CompileTimeObject = {
//             node: runtimeCtor.getDeclarations()[0],
//             symbol: runtimeCtor,
//             loadOps: [ { kind: 'noop', debug: 'RuntimeConstructor' } as Operation],
//             getProperty: (symbol: tsm.Symbol) => {
//                 return symbol.getName() === "platform" ? O.some(platformCTO) : O.none;
//             }
//         }

//         const runtime = findSymbol("Runtime", sourceFile, tsm.ts.SymbolFlags.Variable);
//         const runtimeCTO: CompileTimeObject = {
//             node: runtime.getValueDeclarationOrThrow(),
//             symbol: runtime,
//             loadOps: [ { kind: 'noop', debug: 'Runtime' } as Operation],
//         };

//         const scope = createTestScope(runtimeCTO, runtimeCtorCTO);
//         const func = sourceFile.getFunctionOrThrow('testFunc');
//         const decl = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0];
//         const init = decl.getInitializerOrThrow();

//         const resolved = pipe(
//             init,
//             parseExpressionTree,
//             E.chain(loadTree(scope)),
//             E_fail
//         )



//         // const cto: CompileTimeObject = {
//         //     node: runtime.getValueDeclarationOrThrow(),
//         //     symbol: runtime,
//         //     loadOps: [ { kind: 'noop', debug: 'Runtime' } as Operation];,
//         //     getProperty: (name: string) => {
//         //         if (name === "platform") return 
//         //     }
//         // }
//         // const scope = createTestScope(cto);

//         // const func = sourceFile.getFunctionOrThrow('testFunc');
//         // const decl = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0];
//         // const init = decl.getInitializerIfKindOrThrow(tsm.SyntaxKind.Identifier);

//         // const resolved = pipe(
//         //     init,
//         //     parseExpressionTree,
//         //     E.chain(loadTree(scope)),
//         //     E_fail
//         // )

//         // expect(resolved).to.equal(expectedLoadOps);
//     });

// });