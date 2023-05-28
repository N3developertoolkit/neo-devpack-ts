import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";

import { sc, u } from "@cityofzion/neon-core";

import { createTestProject, createTestGlobalScope, testParseExpression, createTestVariable, createTestScope, expectPushData, expectPushInt } from './testUtils.spec';
import { CallTokenOperation, Operation } from '../src/types/Operation';
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

    describe("enums", () => {
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

    describe("native contracts", () => {

        it("simple property", () => {
            const contract = /*javascript*/`const $VAR = Ledger.currentHash;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(1);
            expectCallToken(result[0], "0xda65b600f7124ce6c79950c1772a36403104f2be", "currentHash", 0, true);
        });

        it("rename property", () => {
            const contract = /*javascript*/`const $VAR = ContractManagement.minimumDeploymentFee;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(1);
            expectCallToken(result[0], "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd", "getMinimumDeploymentFee", 0, true);
        });

        it("single param method", () => {
            const contract = /*javascript*/`const $VAR = StdLib.base58CheckDecode("test");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(2);
            expectPushData(result[0], "test");
            expectCallToken(result[1], "0xacce6fd80d44e1796aa0c2c625e9e4e0ce39efc0", "base58CheckDecode", 1, true);
        });

        it("multi param method", () => {
            const contract = /*javascript*/`const $VAR = Ledger.getTransactionFromBlock(42, 0);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(3);
            expectPushInt(result[0], 0);
            expectPushInt(result[1], 42);
            expectCallToken(result[2], "0xda65b600f7124ce6c79950c1772a36403104f2be", "getTransactionFromBlock", 2, true);
        });

        it("optional param method missing", () => {
            const contract = /*javascript*/`const $VAR = StdLib.atoi("test");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(2);
            expectPushData(result[0], "test");
            expectCallToken(result[1], "0xacce6fd80d44e1796aa0c2c625e9e4e0ce39efc0", "atoi", 1, true);
        })

        it("optional param method provided", () => {
            const contract = /*javascript*/`const $VAR = StdLib.atoi("test", 10);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(3);
            expectPushInt(result[0], 10)
            expectPushData(result[1], "test");
            expectCallToken(result[2], "0xacce6fd80d44e1796aa0c2c625e9e4e0ce39efc0", "atoi", 2, true);
        })

        it("void return method", () => {
            const contract = /*javascript*/`Oracle.request("url", "filter", "callback", null, 0n);`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(6);
            expectPushInt(result[0], 0);
            expect(result[1]).deep.equals({ kind: 'pushnull' });
            expectPushData(result[2], "callback");
            expectPushData(result[3], "filter");
            expectPushData(result[4], "url");
            expectCallToken(result[5], "0xfe924b7cfe89ddd271abaf7210a80a7e11178758", "request", 5, false);
        });

        function expectCallToken(op: Operation, hash: string, method: string, paramCount: number, hasReturn: boolean) {
            expect(op).has.property('kind', 'calltoken');
            const token = (op as CallTokenOperation).token;
            expect(token.hash).equals(u.HexString.fromHex(hash, true).toString());
            expect(token.method).equals(method);
            expect(token.parametersCount).equals(paramCount);
            expect(token.hasReturnValue).equals(hasReturn);
            expect(token.callFlags).equals(sc.CallFlags.All);
        }
    })

    describe("stack items", () => {

        const tests: Record<string, readonly string[]> = {
            Transaction: [
                "hash",
                "version",
                "nonce",
                "sender",
                "systemFee",
                "networkFee",
                "validUntilBlock",
                "script",
            ],
            Block: [
                "hash",
                "version",
                "previousHash",
                "merkleRoot",
                "timestamp",
                "nonce",
                "index",
                "primaryIndex",
                "nextConsensus",
                "transactionsCount"
            ],
            ContractMethodDescriptor: [
                "name",
                "parameters",
            ]
        }

        for (const [type, properties] of Object.entries(tests)) {
            properties.forEach((property, index) => { doTest(type, property, index) })
        }

        function doTest(type: string, property: string, index: number) {
            it(`${type}.${property}`, () => {
                const contract = /*javascript*/`const item: ${type} = null!; const $VAR = item.${property};`;
                const { project, sourceFile } = createTestProject(contract);
                const globalScope = createTestGlobalScope(project);

                const item = sourceFile.getVariableDeclarationOrThrow('item');
                const itemCTO = createTestVariable(item);
                const scope = createTestScope(globalScope, itemCTO);

                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
                const result = testParseExpression(init, scope);

                expect(result).length(3);
                expect(result[0]).equals(itemCTO.loadOp);
                expectPushInt(result[1], index);
                expect(result[2]).deep.equals({ kind: 'pickitem' })
            });
        }
    })
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

    describe("Runtime", () => {

        const properties = [
            ["callFlags", "System.Contract.GetCallFlags"],
            ["remainingGas", "System.Runtime.GasLeft"],
            ["entryScriptHash", "System.Runtime.GetEntryScriptHash"],
            ["executingScriptHash", "System.Runtime.GetExecutingScriptHash"],
            ["invocationCounter", "System.Runtime.GetInvocationCounter"],
            ["platform", "System.Runtime.Platform"],
            ["network", "System.Runtime.GetNetwork"],
            ["addressVersion", "System.Runtime.GetAddressVersion"],
            ["trigger", "System.Runtime.GetTrigger"],
            ["time", "System.Runtime.GetTime"],
            ["scriptContainer", "System.Runtime.GetScriptContainer"],
            ["callingScriptHash", "System.Runtime.GetCallingScriptHash"],
            ["random", "System.Runtime.GetRandom"],
            ["notifications", "System.Runtime.GetNotifications"],
        ];

        properties.forEach(([property, syscall]) => { testSyscallProperty("Runtime", property, syscall) });
    });

    function testSyscallProperty(object: string, property: string, syscall: string) {
        it(property, () => {
            const contract = /*javascript*/`const $VAR = ${object}.${property};`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = testParseExpression(init, scope);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).deep.equals({ kind: 'syscall', name: syscall })
        });
    }

    // TODO: $torage => Storage
    describe("Storage", () => {
        const properties = [
            ["context", "System.Storage.GetContext"],
            ["readonlyContext", "System.Storage.GetReadOnlyContext"],
        ]

        properties.forEach(([property, syscall]) => { testSyscallProperty("$torage", property, syscall) });
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
});

