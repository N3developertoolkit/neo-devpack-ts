import 'mocha';
import { assert, expect } from 'chai';
import * as tsm from 'ts-morph';

import { identity, pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import { parseExpression } from '../src/passes/expressionProcessor';
import { createEmptyScope } from '../src/types/CompileTimeObject';
import { createTestGlobalScope, createTestProject, createTestScope, createTestVariable, expectPushData, testParseExpression } from "./testUtils.spec";
import { Operation } from '../src/types/Operation';
import { sc } from '@cityofzion/neon-core';
import { ts } from 'ts-morph';

describe("expression parser", () => {
    describe.skip("foo", () => {
        it("Storage.readonlyContext.get('key')!.asInteger()", () => {
            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.get("key")!.asInteger();`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).has.length(4);
            expect(result[0]).deep.equals({ kind: 'pushdata', value: Buffer.from("key", 'utf8') });
            expect(result[1]).deep.equals({ kind: 'syscall', name: "System.Storage.GetReadOnlyContext" })
            expect(result[2]).deep.equals({ kind: 'syscall', name: "System.Storage.Get" })
            expect(result[3]).deep.equals({ kind: 'convert', type: sc.StackItemType.Integer });
        });

        it("Storage.readonlyContext.get('key')?.asInteger() ?? 0n", () => {
            // const value = Storage.context.get(key);
            // return value?.asInteger() ?? 0n;
            // Storage.context.get(TOTAL_SUPPLY_KEY)!.asInteger();

            const contract = /*javascript*/`const $VAR = Storage.readonlyContext.get('key')?.asInteger() ?? 0n;`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

        });
    });
    describe("literals", () => {

        function testLiteral(contract: string) {
            const { sourceFile } = createTestProject(contract);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            return testParseExpression(init);
        }

        it("string literal", () => {
            const contract = /*javascript*/ `const $VAR = "Hello, World!";`;
            const result = testLiteral(contract);

            expect(result).lengthOf(1);
            expectPushData(result[0], "Hello, World!");
        });

        it("boolean literal", () => {
            const contract = /*javascript*/ `const $VAR = true;`;
            const result = testLiteral(contract);

            expect(result).lengthOf(1);
            expect(result[0]).has.property('kind', 'pushbool');
            expect(result[0]).has.property('value', true);
        });

        it("null literal", () => {
            const contract = /*javascript*/ `const $VAR = null;`;
            const result = testLiteral(contract);

            expect(result).lengthOf(1);
            expect(result[0]).has.property('kind', 'pushnull');
        });

        it("numeric literal", () => {
            const contract = /*javascript*/ `const $VAR = 42;`;
            const result = testLiteral(contract);

            expect(result).lengthOf(1);
            expect(result[0]).has.property('kind', 'pushint');
            expect(result[0]).has.property('value', 42n);
        });

        it("bigint literal", () => {
            const contract = /*javascript*/ `const $VAR = 108446744073709551616n;`;
            const result = testLiteral(contract);

            expect(result).lengthOf(1);
            expect(result[0]).has.property('kind', 'pushint');
            expect(result[0]).has.property('value', 108446744073709551616n);
        });

        it("invalid numeric literal", () => {
            const contract = /*javascript*/ `const $VAR = 1.234;`;
            const { sourceFile } = createTestProject(contract);
            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();

            const result = pipe(
                init,
                parseExpression(createEmptyScope()),
                E.match(
                    identity,
                    () => expect.fail("Expected parse error")
                )
            );
            expect(result.node).to.equal(init);
        });

        it("array literal", () => {
            const contract = /*javascript*/ `const $VAR = [10,20,30,40,50];`;
            const result = testLiteral(contract);

            expect(result).lengthOf(7);
            expect(result[0]).deep.equals({ kind: 'pushint', value: 10n });
            expect(result[1]).deep.equals({ kind: 'pushint', value: 20n });
            expect(result[2]).deep.equals({ kind: 'pushint', value: 30n });
            expect(result[3]).deep.equals({ kind: 'pushint', value: 40n });
            expect(result[4]).deep.equals({ kind: 'pushint', value: 50n });
            expect(result[5]).deep.equals({ kind: 'pushint', value: 5n });
            expect(result[6]).deep.equals({ kind: 'packarray' });
        });

        describe("object literal", () => {
            it("property", () => {
                const contract = /*javascript*/ `const $VAR = { a: 10, b:20 };`;
                const result = testLiteral(contract);

                expect(result).lengthOf(6);
                expect(result[0]).deep.equals({ kind: 'pushint', value: 10n });
                expectPushData(result[1], "a");
                expect(result[2]).deep.equals({ kind: 'pushint', value: 20n });
                expectPushData(result[3], "b");
                expect(result[4]).deep.equals({ kind: 'pushint', value: 2n });
                expect(result[5]).deep.equals({ kind: 'packmap' });
            });

            it("shorthand property", () => {
                const contract = /*javascript*/ `const a = 10; const b = 20; const $VAR = { a, b };`;
                const { sourceFile } = createTestProject(contract);

                const a = sourceFile.getVariableDeclarationOrThrow('a');
                const aCTO = createTestVariable(a);
                const b = sourceFile.getVariableDeclarationOrThrow('b');
                const bCTO = createTestVariable(b);
                const scope = createTestScope(undefined, [aCTO, bCTO])
    
                const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
                const result = testParseExpression(init, scope);
    
                expect(result).lengthOf(6);
                expect(result[0]).equals(aCTO.loadOp);
                expectPushData(result[1], "a");
                expect(result[2]).equals(bCTO.loadOp);
                expectPushData(result[3], "b");
                expect(result[4]).deep.equals({ kind: 'pushint', value: 2n });
                expect(result[5]).deep.equals({ kind: 'packmap' });
            });
        })

    });

    describe("identifier", () => {
        it("load", () => {
            const contract = /*javascript*/`const $hello = 42; const $VAR = $hello;`;
            const { sourceFile } = createTestProject(contract);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(undefined, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(1);
            expect(result[0]).equals(helloCTO.loadOp);
        });

        it("store", () => {
            const contract = /*javascript*/`let $hello: number; $hello = 42;`;
            const { sourceFile } = createTestProject(contract);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(undefined, helloCTO);

            const node = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement);
            const result = testParseExpression(node.getExpression(), scope);

            expect(result).lengthOf(2);
            expect(result[0]).deep.equals({ kind: 'pushint', value: 42n });
            expect(result[1]).equals(helloCTO.storeOp);
        });
    });
});
