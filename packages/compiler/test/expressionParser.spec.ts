import 'mocha';
import { assert, expect } from 'chai';

import { identity, pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import { parseExpression } from '../src/passes/expressionProcessor';
import { createEmptyScope } from '../src/types/CompileTimeObject';
import { createTestGlobalScope, createTestProject, createTestScope, createTestVariable, testParseExpression } from "./testUtils.spec";
import { Operation } from '../src/types/Operation';
import { sc } from '@cityofzion/neon-core';

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
            expect(result[0]).has.property('kind', 'pushdata');
            expect(result[0]).has.deep.property('value', Buffer.from("Hello, World!", 'utf8'));
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
    });

    describe("identifier", () => {
        it("load", () => {
            const contract = /*javascript*/`const $hello: ByteString = null!; const $VAR = $hello;`;
            const { sourceFile } = createTestProject(contract);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(undefined, helloCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(1);
            expect(result[0]).equals(helloCTO.loadOp);
        });
    });
});
