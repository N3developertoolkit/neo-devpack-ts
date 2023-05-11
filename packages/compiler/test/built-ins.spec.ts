import 'mocha';
import { assert, expect } from 'chai';

import * as tsm from "ts-morph";
import { sc } from "@cityofzion/neon-core";


import { parseExpression } from '../src/passes/expressionProcessor';
import { parse } from 'path';
import { createTestProject, createTestGlobalScope, testParseExpression, createTestScope, createTestVariable } from './testUtils.spec';
import { Operation } from '../src/types/Operation';
import { createScope, CompileTimeObject, CompileTimeObjectOptions, makeCompileTimeObject, ScopedNodeFunc } from '../src/types/CompileTimeObject';


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
    describe("ByteStringConstructor", () => {
        it("fromHex", () => {
            const contract = /*javascript*/`const $VAR = ByteString.fromHex("0xFF");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([255]) })
        });

        it("fromString", () => {
            const contract = /*javascript*/`const $VAR = ByteString.fromString("hello");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([104, 101, 108, 108, 111]) })
        });

        it("fromInteger", () => {
            const contract = /*javascript*/`const $VAR = ByteString.fromInteger(12345);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(2);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: 12345n })
            expect(result[1]).deep.equals(<Operation>{ kind: 'convert', type: sc.StackItemType.ByteString })
        });
    });

    describe("ByteString", () => {
        it("length", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = $hello.length;`;

            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(2);
            expect(result[0]).to.equal(helloCTO.loadOp);
            expect(result[1]).to.deep.equal({ kind: 'size' });
        });

        it("asInteger", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = $hello.asInteger();`;

            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(2);
            expect(result[0]).to.equal(helloCTO.loadOp);
            expect(result[1]).to.deep.equal({ kind: 'convert', type: sc.StackItemType.Integer });
        })
    });

    describe("StorageConstructor", () => {
        it("context", () => {
            const contract = /*javascript*/`const $VAR = Storage.context;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetContext" })
        });

        it("readonlyContext", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
        });
    });

    describe("StorageContext", () => {
        it("get", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.get("key");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(3);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Buffer.from("key", "utf8") })
            expect(result[1]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Get" })
        });

        it("find", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.find($hello, FindOptions.PickField1);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: 32n })
            expect(result[1]).equals(helloCTO.loadOp);
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("asReadony", () => {
            const contract = /*javascript*/`const $VAR = Storage.context.asReadonly;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(2);
            expect(result[0]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetContext" })
            expect(result[1]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.AsReadOnly" })
        });
        it("put", () => {
            const contract = /*javascript*/`const $VAR = Storage.context.put("key", "value");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Buffer.from("value", "utf8") })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushdata', value: Buffer.from("key", "utf8") })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Put" })
        });
        it("delete", () => {
            const contract = /*javascript*/`const $VAR = Storage.context.delete("key");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(3);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Buffer.from("key", "utf8") })
            expect(result[1]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetContext" })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Delete" })
        });
    });
});

