import 'mocha';
import { expect } from 'chai';
import * as tsm from 'ts-morph';

import { identity, pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import { parseExpression } from '../src/passes/expressionProcessor';
import { CompileTimeType, createEmptyScope } from '../src/types/CompileTimeObject';
import { createPropResolver, createPropResolvers, createTestProject, createTestScope, createTestVariable, expectPushData, testParseExpression } from "./testUtils.spec";

describe("expression parser", () => {
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

            expect(result).lengthOf(3);
            expect(result[0]).deep.equals({ kind: 'pushint', value: 42n });
            expect(result[1]).deep.equals({ kind: 'duplicate' });
            expect(result[2]).equals(helloCTO.storeOp);
        });
    });

    it("conditional", () => {
        const contract = /*javascript*/`const $VAR = true ? 42 : 0;`;
        const { sourceFile } = createTestProject(contract);

        const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
        const result = testParseExpression(init);

        expect(result).lengthOf(7);
        expect(result[0]).deep.equals({ kind: 'pushbool', value: true });
        expect(result[1]).deep.equals({ kind: 'jumpifnot', target: result[4] });
        expect(result[2]).deep.equals({ kind: 'pushint', value: 42n });
        expect(result[3]).deep.equals({ kind: 'jump', target: result[6] });
        expect(result[4]).deep.equals({ kind: 'noop', });
        expect(result[5]).deep.equals({ kind: 'pushint', value: 0n });
        expect(result[6]).deep.equals({ kind: 'noop', });
    })

    describe("postfix unary", () => {

        function testExpresion(contract: string, kind: string) {
            const { sourceFile } = createTestProject(contract);

            const hello = sourceFile.getVariableDeclarationOrThrow('$hello');
            const helloCTO = createTestVariable(hello);
            const scope = createTestScope(undefined, helloCTO);

            const node = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement);
            const result = testParseExpression(node.getExpression(), scope);

            expect(result).lengthOf(4);
            expect(result[0]).equals(helloCTO.loadOp);
            expect(result[1]).deep.equals({ kind: 'duplicate' });
            expect(result[2]).deep.equals({ kind });
            expect(result[3]).equals(helloCTO.storeOp);
        }

        it("increment", () => { testExpresion(/*javascript*/`let $hello = 42; $hello++;`, 'increment') });

        it("decrement", () => { testExpresion(/*javascript*/`let $hello = 42; $hello--;`, 'decrement') });
    });

    describe.skip("prefix unary", () => {
        // TODO: add tests
    });

    describe.skip("binary", () => {
        // TODO: add tests
    });

    describe("property access", () => {
        it("object property", () => {
            const contract = /*javascript*/`const test = { value: 42 }; const $VAR = test.value;`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testInit = test.getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.ObjectLiteralExpression);
            const valueCTO = createTestVariable(testInit.getPropertyOrThrow("value"));

            const properties = createPropResolvers(valueCTO);

            const testCTO = createTestVariable(test, { properties });
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(2);
            expect(result[0]).equals(testCTO.loadOp);
            expect(result[1]).equals(valueCTO.loadOp);
        });

        it("type property", () => {
            const contract = /*javascript*/`
                interface Test { value: number; }
                const test:Test = null!;
                const $VAR = test.value;`;
            const { sourceFile } = createTestProject(contract);

            const testInterface = sourceFile.getInterfaceOrThrow('Test');
            const testInterfaceType = testInterface.getType();
            const value = testInterfaceType.getPropertyOrThrow('value');
            const valueCTO = createTestVariable(value.getValueDeclarationOrThrow());
            const properties = new Map([[value, createPropResolver(valueCTO)]])

            const testInterfaceCTT: CompileTimeType = { type: testInterfaceType, properties };

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(undefined, testCTO, testInterfaceCTT);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(2);
            expect(result[0]).equals(testCTO.loadOp);
            expect(result[1]).equals(valueCTO.loadOp);
        });

        it("store object property", () => {
            const contract = /*javascript*/`const test = { value: 42 }; test.value = 42;`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testInit = test.getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.ObjectLiteralExpression);
            const valueCTO = createTestVariable(testInit.getPropertyOrThrow("value"));

            const properties = createPropResolvers(valueCTO);

            const testCTO = createTestVariable(test, { properties });
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(4);
            expect(result[0]).deep.equals({ kind: 'pushint', value: 42n })
            expect(result[1]).deep.equals({ kind: 'duplicate' })
            expect(result[2]).equals(testCTO.loadOp);
            expect(result[3]).equals(valueCTO.storeOp);

        });

        it("store type property", () => {
            const contract = /*javascript*/`
                interface Hello { world: number; }
                const $hello:Hello = null!;
                $hello.world = 42;`;
            const { sourceFile } = createTestProject(contract);

        });


    })
});
