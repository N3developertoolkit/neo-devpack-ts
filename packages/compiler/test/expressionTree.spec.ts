import 'mocha';
import { expect } from 'chai';

import * as tsm from 'ts-morph'
import { identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as S from 'fp-ts/State'

import { createContractProject } from '../src/utils';
import { collectProjectDeclarations } from '../src/passes/collectProjectDeclarations';
import { makeGlobalScope } from '../src/passes/builtins';
import { IdentifierExpressionTree, LiteralExpressionTree, parseExpressionTree } from '../src/passes/expressionResolver';
import { CompileTimeObject, createEmptyScope, createScope, updateScope } from '../src/types/CompileTimeObject';
import { Operation } from '../src/types/Operation';
import { parseExpression } from '../src/passes/expressionProcessor';
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

describe("builts-ins", () => {
    describe("ByteString", () => {
        it("fromHex", () => {
            const contract = /*javascript*/`const VALUE_KEY = ByteString.fromHex("0x00");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const decl = sourceFile.getVariableDeclarationOrThrow('VALUE_KEY');
            const init = decl.getInitializerOrThrow();

            const q = parseExpression(scope)(init);

        })
    })
});

// describe("expression tree", () => {
//     describe("literal", () => {
//         it("string literal", () => {
//             const contract = /*javascript*/`function testFunc() { const value = "Hello, World!" }`;
//             const { sourceFile } = createTestProject(contract);
//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();

//             const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
//             expect(tree).instanceOf(LiteralExpressionTree);
//             expect((tree as LiteralExpressionTree).literal).eq("Hello, World!");

//             expect(tree.load).to.exist;
//             expect(tree.store).to.not.exist;
//             // expect(tree.resolve).to.not.exist;
//             const scope = createEmptyScope();
//             const ops = pipe(scope, tree.load!, E.match(error => expect.fail(error.message), identity));
//             expect(ops).lengthOf(1);
//             expect(ops[0]).to.have.property('kind', 'pushdata')
//             expect(ops[0]).to.have.deep.property('value', Buffer.from("Hello, World!", 'utf8'))
//         })

//         it("boolean literal", () => {
//             const contract = /*javascript*/`function testFunc() { const value = true }`;
//             const { sourceFile } = createTestProject(contract);
//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();

//             const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
//             expect(tree).instanceOf(LiteralExpressionTree);
//             expect((tree as LiteralExpressionTree).literal).eq(true);

//             expect(tree.load).to.exist;
//             expect(tree.store).to.not.exist;
//             // expect(tree.resolve).to.not.exist;
//             const scope = createEmptyScope();
//             const ops = pipe(scope, tree.load!, E.match(error => expect.fail(error.message), identity));
//             expect(ops).lengthOf(1);
//             expect(ops[0]).to.have.property('kind', 'pushbool')
//             expect(ops[0]).to.have.deep.property('value', true)
//         })

//         it("null literal", () => {
//             const contract = /*javascript*/`function testFunc() { const value = null }`;
//             const { sourceFile } = createTestProject(contract);
//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();

//             const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
//             expect(tree).instanceOf(LiteralExpressionTree);
//             expect((tree as LiteralExpressionTree).literal).is.null;

//             expect(tree.load).to.exist;
//             expect(tree.store).to.not.exist;
//             // expect(tree.resolve).to.not.exist;
//             const scope = createEmptyScope();
//             const ops = pipe(scope, tree.load!, E.match(error => expect.fail(error.message), identity));
//             expect(ops).lengthOf(1);
//             expect(ops[0]).to.have.property('kind', 'pushnull')
//         })

//         it("numeric literal", () => {
//             const contract = /*javascript*/`function testFunc() { const value = 42; }`;
//             const { sourceFile } = createTestProject(contract);
//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();

//             const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
//             expect(tree).instanceOf(LiteralExpressionTree);
//             expect((tree as LiteralExpressionTree).literal).eq(42n);

//             expect(tree.load).to.exist;
//             expect(tree.store).to.not.exist;
//             // expect(tree.resolve).to.not.exist;
//             const scope = createEmptyScope();
//             const ops = pipe(scope, tree.load!, E.match(error => expect.fail(error.message), identity));
//             expect(ops).lengthOf(1);
//             expect(ops[0]).to.have.property('kind', 'pushint')
//             expect(ops[0]).to.have.deep.property('value', 42n)
//         })

//         it("bigint literal", () => {
//             const contract = /*javascript*/`function testFunc() { const value = 108446744073709551616n; }`;
//             const { sourceFile } = createTestProject(contract);
//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();

//             const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
//             expect(tree).instanceOf(LiteralExpressionTree);
//             const $tree = tree as LiteralExpressionTree;
//             expect($tree.literal).eq(108446744073709551616n);

//             expect(tree.load).to.exist;
//             expect(tree.store).to.not.exist;
//             // expect(tree.resolve).to.not.exist;
//             const scope = createEmptyScope();
//             const ops = pipe(scope, tree.load!, E.match(error => expect.fail(error.message), identity));
//             expect(ops).lengthOf(1);
//             expect(ops[0]).to.have.property('kind', 'pushint')
//             expect(ops[0]).to.have.deep.property('value', 108446744073709551616n)
//         })

//         it("invalid numeric literal", () => {
//             const contract = /*javascript*/`function testFunc() { const value = 1.234; }`;
//             const { sourceFile } = createTestProject(contract);
//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();

//             pipe(
//                 init,
//                 parseExpressionTree,
//                 E.match(
//                     error => expect(error.node).equal(init),
//                     () => expect.fail("Expected parse error"))
//             );
//         })
//     })

//     describe("identifier", () => {

//         const contract = /*javascript*/`function testFunc(someParam: string) { const value = someParam; }`;
//         const { sourceFile } = createTestProject(contract);
//         const func = sourceFile.getFunctionOrThrow('testFunc');
//         const param = func.getParameters()[0];
//         const cto: CompileTimeObject = {
//             node: param,
//             symbol: param.getSymbolOrThrow(),
//             loadOps: [{ kind: 'noop', debug: 'someParam.load' } as Operation],
//             storeOps: [{ kind: 'noop', debug: 'someParam.store' } as Operation]
//         }
//         const scope = pipe(
//             updateScope(createEmptyScope())(cto, undefined),
//             E.match(expect.fail, identity)
//         )
//         const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();
//         const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
//         expect(tree).instanceOf(IdentifierExpressionTree);
//         const $tree = tree as IdentifierExpressionTree;
//         expect($tree.symbol.getName()).eq("someParam");

//         it("load", () => {
//             expect(tree.load).to.exist;
//             const actual = pipe(scope, tree.load!, E.match(error => expect.fail(error.message), identity));
//             expect(actual).eq(cto.loadOps);
//         });

//         it("store", () => {
//             expect(tree.store).to.exist;
//             const actual = pipe(scope, tree.store!, E.match(error => expect.fail(error.message), identity));
//             expect(actual).eq(cto.storeOps);
//         })

//         // it("resolve", () => {
//         //     // expect(tree.resolve).to.exist;
//         //     const actual = pipe(scope, tree.resolve!, E.match(error => expect.fail(error.message), identity));
//         //     expect(actual).eq(cto);
//         // })
//     });

//     describe("call expression", () => {
//         it("checkWitness", () => {
//             const contract = /*javascript*/`function testFunc(owner: ByteString) { const value = checkWitness(owner); }`;
//             const { project, sourceFile } = createTestProject(contract);
//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const ownerSymbol = func.getSymbolsInScope(tsm.ts.SymbolFlags.Variable).find(s => s.getName() === 'owner');
//             if (!ownerSymbol) expect.fail("owner not found");
//             const cto: CompileTimeObject = {
//                 node: ownerSymbol.getDeclarations()[0],
//                 symbol: ownerSymbol,
//                 loadOps: [{ kind: 'noop', debug: 'owner.load' } as Operation],
//                 storeOps: [{ kind: 'noop', debug: 'owner.store' } as Operation]
//             }

//             const globalScope = createTestGlobalScope(project);
//             const scope = pipe([cto], createScope(globalScope), E.match(expect.fail, identity));

//             const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();
//             const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
//             expect(tree.load).to.exist;

//         });
//     });
// });