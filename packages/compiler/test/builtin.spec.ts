import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";
import * as E from 'fp-ts/Either';
import * as ROA from 'fp-ts/ReadonlyArray';

import { sc, u } from "@cityofzion/neon-core";

import { createTestProject, createTestGlobalScope, testParseExpression, createTestVariable, createTestScope, expectPushData, expectPushInt, expectResults } from './testUtils.spec';
import { CallTokenOperation, Operation, pushInt, pushString } from '../src/types/Operation';
import { FindOptions } from '../src/builtin/storage';
import { pipe } from 'fp-ts/lib/function';
import { parseExpression } from '../src/passes/expressionProcessor';
import { CompileTimeObject } from '../src/types/CompileTimeObject';

describe("builts-ins", () => {
    describe("Map", () => {
        it("new Map()", () => {
            const contract = /*javascript*/`const $VAR = new Map<string, any>();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result, { kind: 'newemptymap' });
        });

        it("Map.set", () => {
            const contract = /*javascript*/`const map: Map<string, any> = null!; map.set("test", 42);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const $map = sourceFile.getVariableDeclarationOrThrow('map');
            const mapCTO = createTestVariable($map);
            const scope = createTestScope(globalScope, mapCTO);

            const expr = sourceFile.getStatements()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(expr, scope);

            expectResults(result,
                mapCTO.loadOp,
                pushString("test"),
                pushInt(42),
                { kind: 'setitem' }
            );
        });

        
        it("Map.clear", () => {
            const contract = /*javascript*/`const map: Map<string, any> = null!; map.clear();`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const $map = sourceFile.getVariableDeclarationOrThrow('map');
            const mapCTO = createTestVariable($map);
            const scope = createTestScope(globalScope, mapCTO);

            const expr = sourceFile.getStatements()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(expr, scope);

            expectResults(result,
                mapCTO.loadOp,
                { kind: 'clearitems' }
            );
        });

        
        it("Map.delete", () => {
            const contract = /*javascript*/`const map: Map<string, any> = null!; map.delete("test");`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const $map = sourceFile.getVariableDeclarationOrThrow('map');
            const mapCTO = createTestVariable($map);
            const scope = createTestScope(globalScope, mapCTO);

            const expr = sourceFile.getStatements()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(expr, scope);

            expectResults(result,
                mapCTO.loadOp,
                pushString("test"),
                { kind: 'removeitem' }
            );
        });

        it("Map.get", () => {
            const contract = /*javascript*/`const map: Map<string, any> = null!; const $VAR = map.get("test");`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const $map = sourceFile.getVariableDeclarationOrThrow('map');
            const mapCTO = createTestVariable($map);
            const scope = createTestScope(globalScope, mapCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result,
                mapCTO.loadOp,
                pushString("test"),
                { kind: 'pickitem' }
            );
        });

        it("Map.has", () => {
            const contract = /*javascript*/`const map: Map<string, any> = null!; const $VAR = map.has("test");`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const $map = sourceFile.getVariableDeclarationOrThrow('map');
            const mapCTO = createTestVariable($map);
            const scope = createTestScope(globalScope, mapCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result,
                mapCTO.loadOp,
                pushString("test"),
                { kind: 'haskey' }
            );
        });

        
        it("Map.size", () => {
            const contract = /*javascript*/`const map: Map<string, any> = null!; const $VAR = map.size;`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const $map = sourceFile.getVariableDeclarationOrThrow('map');
            const mapCTO = createTestVariable($map);
            const scope = createTestScope(globalScope, mapCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result,
                mapCTO.loadOp,
                { kind: 'size' }
            );
        });
    });

    describe("Error", () => {
        it("Error()", () => {
            const contract = /*javascript*/`throw Error();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expectPushData(result[0], Uint8Array.from([]));
        });

        it("Error('message')", () => {
            const contract = /*javascript*/`throw Error('message');`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expectPushData(result[0], "message");
        });

        it("new Error()", () => {
            const contract = /*javascript*/`throw new Error();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expectPushData(result[0], Uint8Array.from([]));
        });

        it("new Error('message')", () => {
            const contract = /*javascript*/`throw new Error('message');`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);
            const stmt = sourceFile.getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ThrowStatement);
            const expr = stmt.getExpression();

            const result = testParseExpression(expr, scope);
            expect(result).to.have.lengthOf(1);
            expectPushData(result[0], "message");
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
            expect(result).to.have.lengthOf(3);
            expect(result[0]).deep.equals({ kind: 'pushnull'});
            expectPushData(result[1], "test");
            expectCallToken(result[2], "0xacce6fd80d44e1796aa0c2c625e9e4e0ce39efc0", "atoi", 2, true);
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
            const hash: Hash160 = null!; 
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

    describe("StorageConstructor", () => {
        const properties = [
            ["context", "System.Storage.GetContext"],
            ["readonlyContext", "System.Storage.GetReadOnlyContext"],
        ]

        properties.forEach(([property, syscall]) => { testSyscallProperty("Storage", property, syscall) });
    })

    describe("ByteStringConstructor", () => {
        describe("fromInteger", () => {
            it("numeric literal", () => {
                const contract = /*javascript*/`const $VAR = ByteString.fromInteger(8191);`;
                const { project, sourceFile } = createTestProject(contract);
                const scope = createTestGlobalScope(project);
                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

                const result = testParseExpression(init, scope);
                expect(result).to.have.lengthOf(1);
                expectPushData(result[0], Buffer.from("FF1F", "hex"))
            });

            it("bigint literal", () => {
                const contract = /*javascript*/`const $VAR = ByteString.fromInteger(8191n);`;
                const { project, sourceFile } = createTestProject(contract);
                const scope = createTestGlobalScope(project);
                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

                const result = testParseExpression(init, scope);
                expect(result).to.have.lengthOf(1);
                expectPushData(result[0], Buffer.from("FF1F", "hex"))
            });

            it("constant", () => {
                const contract = /*javascript*/`
                    const value: number = 8191!;
                    const $VAR = ByteString.fromInteger(value);`;
                const { project, sourceFile } = createTestProject(contract);
                const globalScope = createTestGlobalScope(project);
                const value = sourceFile.getVariableDeclarationOrThrow('value');
                const valueCTO = createTestVariable(value, {
                    loadOps: [{ kind: 'pushint', value: 8191n }]
                });
                const scope = createTestScope(globalScope, valueCTO)

                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
                const result = testParseExpression(init, scope);
                expect(result).to.have.lengthOf(1);
                expectPushData(result[0], Buffer.from("FF1F", "hex"))
            });

            it("non constant", () => {
                const contract = /*javascript*/`
                    const value: number = 8191!;
                    const $VAR = ByteString.fromInteger(value);`;
                const { project, sourceFile } = createTestProject(contract);
                const globalScope = createTestGlobalScope(project);
                const value = sourceFile.getVariableDeclarationOrThrow('value');
                const valueCTO = createTestVariable(value);
                const scope = createTestScope(globalScope, valueCTO)

                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
                const result = testParseExpression(init, scope);
                expect(result).to.have.lengthOf(2);
                expect(result[0]).equal(valueCTO.loadOp);
                expect(result[1]).deep.equals({ kind: "convert", type: sc.StackItemType.ByteString })
            });
        });

        describe("fromHex", () => {
            it("with prefix", () => {
                const contract = /*javascript*/`const $VAR = ByteString.fromHex("0xFF");`;
                const { project, sourceFile } = createTestProject(contract);
                const scope = createTestGlobalScope(project);
                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

                const result = testParseExpression(init, scope);
                expect(result).to.have.lengthOf(1);
                expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([255]) })
            });

            it("without prefix", () => {
                const contract = /*javascript*/`const $VAR = ByteString.fromHex("FF");`;
                const { project, sourceFile } = createTestProject(contract);
                const scope = createTestGlobalScope(project);
                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

                const result = testParseExpression(init, scope);
                expect(result).to.have.lengthOf(1);
                expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([255]) })
            });

            it("invalid hex string", () => {
                const contract = /*javascript*/`const $VAR = ByteString.fromHex("test");`;
                const { project, sourceFile } = createTestProject(contract);
                const scope = createTestGlobalScope(project);
                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

                pipe(
                    init,
                    parseExpression(scope),
                    E.match(
                        error => expect(error.message).equal("invalid hex string"),
                        () => expect.fail("expected error")
                    )
                );
            });

            it("const string value", () => {
                const contract = /*javascript*/`
                    const value: string = "";
                    const $VAR = ByteString.fromHex(value);`;
                const { project, sourceFile } = createTestProject(contract);
                const globalScope = createTestGlobalScope(project);
                const value = sourceFile.getVariableDeclarationOrThrow('value');
                const valueCTO = createTestVariable(value, {
                    loadOps: [{ kind: 'pushdata', value: Buffer.from("0xFF") }]
                });
                const scope = createTestScope(globalScope, valueCTO)

                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
                const result = testParseExpression(init, scope);
                expect(result).to.have.lengthOf(1);
                expect(result[0]).deep.equals(<Operation>{ kind: 'pushdata', value: Uint8Array.from([255]) })
            });

            it("non const string value", () => {
                const contract = /*javascript*/`
                const value: string = "";
                const $VAR = ByteString.fromHex(value);`;
                const { project, sourceFile } = createTestProject(contract);
                const globalScope = createTestGlobalScope(project);
                const value = sourceFile.getVariableDeclarationOrThrow('value');
                const valueCTO = createTestVariable(value);
                const scope = createTestScope(globalScope, valueCTO)

                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
                pipe(
                    init,
                    parseExpression(scope),
                    E.match(
                        error => expect(error.message).equal("fromHex requires a string literal argument"),
                        () => expect.fail("expected error")
                    )
                );
            });
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
    });

    describe("Hash160", () => {
        it("zero", () => {
            const contract = /*javascript*/`const $hello = Hash160.zero;`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);
            const init = sourceFile.getVariableDeclarationOrThrow('$hello').getInitializerOrThrow();
            const result = testParseExpression(init, globalScope);
            expectResults(result,
                { kind: 'pushdata', value: Buffer.alloc(20) }
            );
        });

        it("is zero", () => {
            const contract = /*javascript*/`const $hello = Hash160.zero; const $VAR = $hello.isZero;`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);
            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);
            expectResults(result,
                helloCTO.loadOp,
                pushInt(0),
                { kind: 'numequal' }
            );
        });

        it("valid", () => {
            const contract = /*javascript*/`const $hello = Hash160.zero; const $VAR = $hello.valid;`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);
            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);
            expectResults(result,
                helloCTO.loadOp,
                { kind: 'duplicate' },
                { kind: 'isnull' },
                { kind: 'jumpif', offset: 5 },
                { kind: 'duplicate' },
                { kind: 'size' },
                pushInt(20),
                { kind: 'jumpeq', offset: 2 },
                { kind: 'throw' }
            );
        });

        it("asAddress", () => {
            const contract = /*javascript*/`const $hello = Hash160.zero; const $VAR = $hello.asAddress();`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);
            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);
            expectResults(result,
                { kind: 'syscall', name: 'System.Runtime.GetAddressVersion' },
                helloCTO.loadOp,
                { kind: 'concat' },
                { $kind: 'calltoken' }
            );
            const callTokenOp = result[3] as CallTokenOperation;
            expect(callTokenOp.token.method).equals('base58CheckEncode');
            expect(callTokenOp.token.hash).equals("c0ef39cee0e4e925c6c2a06a79e1440dd86fceac");
        });

        
        it("asAddress arg", () => {
            const contract = /*javascript*/`const $hello = Hash160.zero; const $VAR = $hello.asAddress(42);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);
            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);
            expectResults(result,
                pushInt(42),
                helloCTO.loadOp,
                { kind: 'concat' },
                { $kind: 'calltoken' }
            );
            const callTokenOp = result[3] as CallTokenOperation;
            expect(callTokenOp.token.method).equals('base58CheckEncode');
            expect(callTokenOp.token.hash).equals("c0ef39cee0e4e925c6c2a06a79e1440dd86fceac");
        });

        
        it("asByteString", () => {
            const contract = /*javascript*/`const $hello = Hash160.zero; const $VAR = $hello.asByteString();`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);
            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);
            expectResults(result,
                helloCTO.loadOp,
            );
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

            expectResults(result,
                helloCTO.loadOp,
                { kind: 'size' })
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

            expectResults(result,
                helloCTO.loadOp,
                { kind: 'duplicate'},
                { kind: 'isnull'},
                { kind: 'jumpifnot', offset: 4 },
                { kind: 'drop' },
                pushInt(0),
                { kind: 'jump', offset: 2 },
                { kind: "convert", type: sc.StackItemType.Integer }
            )
        })

        it("asHash160", () => {
            const contract = /*javascript*/`const $hello = ByteString.fromString("hello"); const $VAR = $hello.asHash160();`;

            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(globalScope, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result,
                helloCTO.loadOp,
                { kind: 'duplicate'},
                { kind: 'isnull'},
                { kind: 'jumpif', offset: 5 },
                { kind: 'duplicate'},
                { kind: "size"},
                pushInt(20),
                { kind: 'jumpeq', offset: 2 },
                { kind: 'throw' },
            )
        })
    });

    describe("StorageContext", () => {
        it("get", () => {
            const contract = /*javascript*/`
                const key: ByteString = null!;
                const $VAR = Storage.context.get(key);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const key = sourceFile.getVariableDeclarationOrThrow('key');
            const contextCTO = createTestVariable(key);
            const scope = createTestScope(globalScope, contextCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(3);
            expect(result[0]).equals(contextCTO.loadOp);
            expect(result[1]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetContext' })
            expect(result[2]).deep.equals({ kind: 'syscall', name: "System.Storage.Get" })
        })

        it("asReadonly", () => {
            const contract = /*javascript*/`
                const $VAR = Storage.context.asReadonly;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(2);
            expect(result[0]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetContext' })
            expect(result[1]).deep.equals({ kind: 'syscall', name: "System.Storage.AsReadOnly" })
        })

        it("put", () => {
            const contract = /*javascript*/`
                const key: ByteString = null!;
                const value: ByteString = null!;
                Storage.context.put(key, value);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const key = sourceFile.getVariableDeclarationOrThrow('key');
            const keyCTO = createTestVariable(key);
            const value = sourceFile.getVariableDeclarationOrThrow('value');
            const valueCTO = createTestVariable(value)
            const scope = createTestScope(globalScope, [keyCTO, valueCTO]);

            const init = sourceFile.forEachChildAsArray()[2]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpression();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(4);
            expect(result[0]).equals(valueCTO.loadOp);
            expect(result[1]).equals(keyCTO.loadOp);
            expect(result[2]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetContext' })
            expect(result[3]).deep.equals({ kind: 'syscall', name: "System.Storage.Put" })
        })

        it("delete", () => {
            const contract = /*javascript*/`
                const key: ByteString = null!;
                Storage.context.delete(key);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const key = sourceFile.getVariableDeclarationOrThrow('key');
            const keyCTO = createTestVariable(key);
            const scope = createTestScope(globalScope, keyCTO);

            const init = sourceFile.forEachChildAsArray()[1]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpression();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(3);
            expect(result[0]).equals(keyCTO.loadOp);
            expect(result[1]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetContext' })
            expect(result[2]).deep.equals({ kind: 'syscall', name: "System.Storage.Delete" })
        })
    });
    describe("ReadonlyStorageContext", () => {
        it("get", () => {
            const contract = /*javascript*/`
                const key: ByteString = null!;
                const $VAR = Storage.readonlyContext.get(key);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const key = sourceFile.getVariableDeclarationOrThrow('key');
            const contextCTO = createTestVariable(key);
            const scope = createTestScope(globalScope, contextCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(3);
            expect(result[0]).equals(contextCTO.loadOp);
            expect(result[1]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetReadOnlyContext' })
            expect(result[2]).deep.equals({ kind: 'syscall', name: "System.Storage.Get" })
        })

        it("find", () => {
            const contract = /*javascript*/`
                const prefix: ByteString = null!;
                const $VAR = Storage.readonlyContext.find(prefix, FindOptions.None);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const prefix = sourceFile.getVariableDeclarationOrThrow('prefix');
            const prefixCTO = createTestVariable(prefix);
            const scope = createTestScope(globalScope, prefixCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(4);
            expectPushInt(result[0], FindOptions.None);
            expect(result[1]).equals(prefixCTO.loadOp);
            expect(result[2]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetReadOnlyContext' })
            expect(result[3]).deep.equals({ kind: 'syscall', name: "System.Storage.Find" })
        })

        it("values", () => {
            const contract = /*javascript*/`
                const prefix: ByteString = null!;
                const $VAR = Storage.readonlyContext.values(prefix);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const prefix = sourceFile.getVariableDeclarationOrThrow('prefix');
            const prefixCTO = createTestVariable(prefix);
            const scope = createTestScope(globalScope, prefixCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(4);
            expectPushInt(result[0], FindOptions.ValuesOnly);
            expect(result[1]).equals(prefixCTO.loadOp);
            expect(result[2]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetReadOnlyContext' })
            expect(result[3]).deep.equals({ kind: 'syscall', name: "System.Storage.Find" })
        })

        it("keys remove prefix literal", () => {
            const contract = /*javascript*/`
                const prefix: ByteString = null!;
                const $VAR = Storage.readonlyContext.keys(prefix, true);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const prefix = sourceFile.getVariableDeclarationOrThrow('prefix');
            const prefixCTO = createTestVariable(prefix);
            const scope = createTestScope(globalScope, prefixCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(4);
            expectPushInt(result[0], FindOptions.KeysOnly | FindOptions.RemovePrefix);
            expect(result[1]).equals(prefixCTO.loadOp);
            expect(result[2]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetReadOnlyContext' })
            expect(result[3]).deep.equals({ kind: 'syscall', name: "System.Storage.Find" })
        })

        it("keys dont remove prefix literal", () => {
            const contract = /*javascript*/`
                const prefix: ByteString = null!;
                const $VAR = Storage.readonlyContext.keys(prefix, false);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const prefix = sourceFile.getVariableDeclarationOrThrow('prefix');
            const prefixCTO = createTestVariable(prefix);
            const scope = createTestScope(globalScope, prefixCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(4);
            expectPushInt(result[0], FindOptions.KeysOnly);
            expect(result[1]).equals(prefixCTO.loadOp);
            expect(result[2]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetReadOnlyContext' })
            expect(result[3]).deep.equals({ kind: 'syscall', name: "System.Storage.Find" })
        })

        
        it("keys no remove prefix param", () => {
            const contract = /*javascript*/`
                const prefix: ByteString = null!;
                const $VAR = Storage.readonlyContext.keys(prefix);`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const prefix = sourceFile.getVariableDeclarationOrThrow('prefix');
            const prefixCTO = createTestVariable(prefix);
            const scope = createTestScope(globalScope, prefixCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).to.have.lengthOf(4);
            expectPushInt(result[0], FindOptions.KeysOnly);
            expect(result[1]).equals(prefixCTO.loadOp);
            expect(result[2]).deep.equals({ kind: 'syscall', name: 'System.Storage.GetReadOnlyContext' })
            expect(result[3]).deep.equals({ kind: 'syscall', name: "System.Storage.Find" })
        })
    })
});

