import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";

import { sc } from "@cityofzion/neon-core";

import { createTestProject, createTestGlobalScope, testParseExpression, createTestVariable, createTestScope, expectPushData, expectPushInt } from './testUtils.spec';
import { Operation } from '../src/types/Operation';
import { FindOptions } from '../src/builtin/storage';

describe("builts-ins", () => {
    describe.skip("Error", () => {
        it("Error()", () => {
            const contract = /*javascript*/`throw Error();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([]) })
        });

        it("Error('message')", () => {
            const contract = /*javascript*/`throw Error('message');`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Buffer.from('message', "utf8") })
        });

        it("new Error()", () => {
            const contract = /*javascript*/`throw new Error();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([]) })
        });

        it("new Error('message')", () => {
            const contract = /*javascript*/`throw new Error('message');`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Buffer.from('message', "utf8") })
        });
    });

    describe("Enums", () => {
        it("CallFlags.None", () => {
            const contract = /*javascript*/`const $VAR = CallFlags.None;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(1);
            expectPushInt(result[0], 0);
        });

        it("CallFlags.All", () => {
            const contract = /*javascript*/`const $VAR = CallFlags.All;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(1);
            expectPushInt(result[0], 15);
        });
    })

    describe("syscall functions", () => {
        it("burnGas", () => {
            const contract = /*javascript*/`burnGas(10n);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const expr = sourceFile.forEachChildAsArray()[0]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(expr, scope);

            expect(result).length(2);
            expectPushInt(result[0], 10);
            expect(result[1]).deep.equals({ kind: 'syscall', name: "System.Runtime.BurnGas" })
        });

        
        it("checkWitness", () => {
            const contract = /*javascript*/`
                const account: ByteString = null!; 
                checkWitness(account);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const account = sourceFile.getVariableDeclarationOrThrow('account');
            const accountCTO = createTestVariable(account);
            const scope = createTestScope(globalScope, accountCTO)

            const expr = sourceFile.forEachChildAsArray()[1]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(expr, scope);

            expect(result).length(2);
            expect(result[0]).equals(accountCTO.loadOp);
            expect(result[1]).deep.equals({ kind: 'syscall', name: "System.Runtime.CheckWitness" })
        });
    });

    it("callContract", () => {
        const contract = /*javascript*/`
            const hash: ByteString = null!; 
            callContract(hash, "method", CallFlags.All, 42, "hello");`;
        const { project, sourceFile } = createTestProject(contract);
        const globalScope = createTestGlobalScope(project);

        const hash = sourceFile.getVariableDeclarationOrThrow('hash');
        const hashCTO = createTestVariable(hash);
        const scope = createTestScope(globalScope, hashCTO)

        const expr = sourceFile.forEachChildAsArray()[1]
            .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
        const result = testParseExpression(expr, scope);

        expect(result).length(8);
        expectPushData(result[0], "hello");
        expectPushInt(result[1], 42);
        expectPushInt(result[2], 2);
        expect(result[3]).deep.equals({ kind: 'packarray' })
        expectPushInt(result[4], 15); // 15 == CallFlags.all
        expectPushData(result[5], "method");
        expect(result[6]).equals(hashCTO.loadOp);
        expect(result[7]).deep.equals({ kind: 'syscall', name: "System.Contract.Call" })
    })

    describe.skip("ByteStringConstructor", () => {
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

    describe.skip("ByteString", () => {
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

    describe.skip("StorageConstructor", () => {
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

    describe.skip("StorageContext", () => {
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
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.PickField1) })
            expect(result[1]).equals(helloCTO.loadOp);
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("values no prefix", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.values();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.ValuesOnly) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([]) })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("values null prefix", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.values(null);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.ValuesOnly) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushnull' })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("values undefined prefix", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.values(undefined);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.ValuesOnly) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushnull' })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("values with prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.values($hello);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.ValuesOnly) })
            expect(result[1]).equals(helloCTO.loadOp);
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("keys no prefix", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.keys();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.KeysOnly | FindOptions.RemovePrefix) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([]) })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("keys with prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.keys($hello);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.KeysOnly | FindOptions.RemovePrefix) })
            expect(result[1]).equals(helloCTO.loadOp);
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("keys with prefix and not keep prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.keys($hello, false);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.KeysOnly | FindOptions.RemovePrefix) })
            expect(result[1]).equals(helloCTO.loadOp);
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("keys with prefix and keep prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.keys($hello, true);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.KeysOnly) })
            expect(result[1]).equals(helloCTO.loadOp);
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("keys undefined prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.keys(undefined);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.KeysOnly | FindOptions.RemovePrefix) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushnull' })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        
        it("keys undefined prefix and not keep prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.keys(undefined, false);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.KeysOnly | FindOptions.RemovePrefix) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushnull' })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });
        
        it("keys undefined prefix and keep prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.keys(undefined, true);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.KeysOnly) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushnull' })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("entries no prefix", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.entries();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.RemovePrefix) })
            expect(result[1]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([]) })
            expect(result[2]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[3]).deep.equals(<Operation>{ kind: 'syscall', name: "System.Storage.Find" })
        });

        it("entries with prefix", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = Storage.readonlyContext.entries($hello);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).length(4);
            expect(result[0]).deep.equals(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.RemovePrefix) })
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

