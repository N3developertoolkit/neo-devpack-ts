import 'mocha';
import { expect } from 'chai';
import * as tsm from 'ts-morph';

import { identity, pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import { parseExpression, reduceExpressionHead } from '../src/passes/expressionProcessor';
import { CompileTimeType, createEmptyScope } from '../src/types/CompileTimeObject';
import { createPropResolver, createPropResolvers, createTestProject, createTestScope, createTestVariable, expectPushData, makeFunctionInvoker as createFunctionInvoker, testParseExpression, expectPushInt, expectResults, createTestGlobalScope, expectEither, createVarDeclCTO } from "./testUtils.spec";
import { Operation, pushInt, pushString } from '../src/types/Operation';
import { sc } from '@cityofzion/neon-core';

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
            expectPushInt(result[0], 42);
        });

        it("bigint literal", () => {
            const contract = /*javascript*/ `const $VAR = 108446744073709551616n;`;
            const result = testLiteral(contract);

            expect(result).lengthOf(1);
            expectPushInt(result[0], 108446744073709551616n);
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
            expectPushInt(result[0], 10);
            expectPushInt(result[1], 20);
            expectPushInt(result[2], 30);
            expectPushInt(result[3], 40);
            expectPushInt(result[4], 50);
            expectPushInt(result[5], 5);
            expect(result[6]).deep.equals({ kind: 'packarray' });
        });

        describe("object literal", () => {
            it("property", () => {
                const contract = /*javascript*/ `const $VAR = { a: 10, b:20 };`;
                const result = testLiteral(contract);

                expect(result).lengthOf(6);
                expectPushInt(result[0], 10);
                expectPushData(result[1], "a");
                expectPushInt(result[2], 20);
                expectPushData(result[3], "b");
                expectPushInt(result[4], 2);
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
                expectPushInt(result[4], 2);
                expect(result[5]).deep.equals({ kind: 'packmap' });
            });
        })

    });

    describe("assignment", () => {
        it("identifier", () => {
            const contract = /*javascript*/ `let a; a = 42;`
            const { sourceFile } = createTestProject(contract);
            const a = createVarDeclCTO(sourceFile, 'a');
            const scope = createTestScope(undefined, a);

            const expr = sourceFile.forEachChildAsArray()[1]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpressionIfKindOrThrow(tsm.SyntaxKind.BinaryExpression);
            const result = testParseExpression(expr, scope);

            expectResults(result,
                pushInt(42),
                { kind: "duplicate" },
                a.storeOp);
        })


        it("array literal", () => {
            const contract = /*javascript*/ `let a, b, d; let value = [1,2,3,4]; [a,b,,d] = value;`
            const { sourceFile } = createTestProject(contract);

            const a = createVarDeclCTO(sourceFile, 'a');
            const b = createVarDeclCTO(sourceFile, 'b');
            const d = createVarDeclCTO(sourceFile, 'd');
            const value = createVarDeclCTO(sourceFile, 'value');
            const scope = createTestScope(undefined, [a, b, d, value]);

            const expr = sourceFile.forEachChildAsArray()[2]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpressionIfKindOrThrow(tsm.SyntaxKind.BinaryExpression);
            const lhs = expr.getLeft().asKindOrThrow(tsm.SyntaxKind.ArrayLiteralExpression);
            const elements = lhs.getElements();
            const result = testParseExpression(expr, scope);

            expectResults(result,
                value.loadOp,
                { kind: 'duplicate' },
                { kind: 'duplicate', location: elements[0] },
                pushInt(0),
                { kind: 'pickitem' },
                a.storeOp,
                { kind: 'duplicate', location: elements[1] },
                pushInt(1),
                { kind: 'pickitem' },
                b.storeOp,
                pushInt(3, elements[3]),
                { kind: 'pickitem' },
                d.storeOp,
            )
        })

        it("nested array literal", () => {
            const contract = /*javascript*/ `let a, b, d; let value = [[1,2],4] as const; [[a,b],d] = value;`
            const { sourceFile } = createTestProject(contract);

            const a = createVarDeclCTO(sourceFile, 'a');
            const b = createVarDeclCTO(sourceFile, 'b');
            const d = createVarDeclCTO(sourceFile, 'd');
            const value = createVarDeclCTO(sourceFile, 'value');
            const scope = createTestScope(undefined, [a, b, d, value]);

            const expr = sourceFile.forEachChildAsArray()[2]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpressionIfKindOrThrow(tsm.SyntaxKind.BinaryExpression);
            const lhs = expr.getLeft().asKindOrThrow(tsm.SyntaxKind.ArrayLiteralExpression);
            const elements = lhs.getElements();
            const nestedElements = elements[0].asKindOrThrow(tsm.SyntaxKind.ArrayLiteralExpression).getElements();
            const result = testParseExpression(expr, scope);

            expectResults(result,
                value.loadOp,
                { kind: 'duplicate' },
                { kind: 'duplicate', location: elements[0] },
                pushInt(0),
                { kind: 'pickitem' },
                { kind: 'duplicate', location: nestedElements[0] },
                pushInt(0),
                { kind: 'pickitem' },
                a.storeOp,
                pushInt(1, nestedElements[1]),
                { kind: 'pickitem' },
                b.storeOp,
                pushInt(1, elements[1]),
                { kind: 'pickitem' },
                d.storeOp,
            )
        })

        it("object literal", () => {
            // since curly braces deliniate blocks and objects, not sure TS supports directly assigning to an object literal
            // however, it is absolutely possible to destructure via an object literal in a for loop initializer 
            const contract = /*javascript*/`let value = {a:1, b:2, c:3, d:4}; let a,z,d; for ({ a, c:z, d} of [value]) {}; `;
            const { sourceFile } = createTestProject(contract);

            const a = createVarDeclCTO(sourceFile, 'a');
            const z = createVarDeclCTO(sourceFile, 'z');
            const d = createVarDeclCTO(sourceFile, 'd');
            const value = createVarDeclCTO(sourceFile, 'value');
            const scope = createTestScope(undefined, [a, z, d, value]);


            const children = sourceFile.forEachChildAsArray();
            const expr = children[2].asKindOrThrow(tsm.SyntaxKind.ForOfStatement).getInitializer().asKindOrThrow(tsm.SyntaxKind.ObjectLiteralExpression);
            const result = pipe(reduceExpressionHead(scope, expr), E.chain(ctx => ctx.getStoreOps()), expectEither);
            
            // TODO: automate valiation of the result

            // expect(result).length(3);
            // expect(result[0].cto).equals(a);
            // expect(result[0].index).deep.equals(['a']);
            // expect(result[1].cto).equals(z);
            // expect(result[1].index).deep.equals(['c']);
            // expect(result[2].cto).equals(d);
            // expect(result[2].index).deep.equals(['d']);
        });

        it("nested object literal", () => {
            const contract = /*javascript*/ `let value = {a:1, b:2, c:3, d:4}; let a,z,d,q; [{a, c:z},q] = [value, 42] as const;`
            const { sourceFile } = createTestProject(contract);

            const a = createVarDeclCTO(sourceFile, 'a');
            const d = createVarDeclCTO(sourceFile, 'd');
            const z = createVarDeclCTO(sourceFile, 'q');
            const q = createVarDeclCTO(sourceFile, 'z');
            const value = createVarDeclCTO(sourceFile, 'value');
            const scope = createTestScope(undefined, [a, z, q, d, value]);

            const expr = sourceFile.forEachChildAsArray()[2]
                .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpressionIfKindOrThrow(tsm.SyntaxKind.BinaryExpression);
            // const lhs = expr.getLeft().asKindOrThrow(tsm.SyntaxKind.ArrayLiteralExpression);
            // const elements = lhs.getElements();
            // const nestedElements = elements[0].asKindOrThrow(tsm.SyntaxKind.ArrayLiteralExpression).getElements();
            const result = testParseExpression(expr, scope);

            // TODO: automate valiation of the result
            // expectResults(result,
            //     value.loadOp,
            //     { kind: 'duplicate' },
            //     { kind: 'duplicate', location: elements[0] },
            //     pushInt(0),
            //     { kind: 'pickitem' },
            //     { kind: 'duplicate', location: nestedElements[0] },
            //     pushInt(0),
            //     { kind: 'pickitem' },
            //     a.storeOp,
            //     pushInt(1, nestedElements[1]),
            //     { kind: 'pickitem' },
            //     b.storeOp,
            //     pushInt(1, elements[1]),
            //     { kind: 'pickitem' },
            //     d.storeOp,
            // )
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
            expectPushInt(result[0], 42);
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
        expectPushInt(result[2], 42);
        expect(result[3]).deep.equals({ kind: 'jump', target: result[6] });
        expect(result[4]).deep.equals({ kind: 'noop', });
        expectPushInt(result[5], 0);
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



    //     it("nested object literal", () => {
    //         // since curly braces deliniate blocks and objects, not sure TS supports directly assigning to an object literal
    //         // however, it is absolutely possible to destructure via an object literal in a for loop initializer 
    //         const contract = /*javascript*/`let foo = {a:1, b:2, c:{x:10, y:11, z: 12}, d:4}; let a,w,z; for ({ a, c:{x:w, z}} of [foo]) {}; `;
    //         const { sourceFile } = createTestProject(contract);

    //         const a = createVarDeclCTO(sourceFile, 'a');
    //         const z = createVarDeclCTO(sourceFile, 'z');
    //         const w = createVarDeclCTO(sourceFile, 'w');
    //         const scope = createTestScope(undefined, [a, z, w]);

    //         const children = sourceFile.forEachChildAsArray();
    //         const expr = children[2].asKindOrThrow(tsm.SyntaxKind.ForOfStatement).getInitializer();
    //         expect(tsm.Node.isExpression(expr)).true;
    //         const result = pipe(expr as tsm.Expression, readAssignmentExpression(scope), expectEither, flattenNestedAssignmentBinding);


    //         expect(result).length(3);
    //         expect(result[0].cto).equals(a);
    //         expect(result[0].index).deep.equals(['a']);
    //         expect(result[1].cto).equals(w);
    //         expect(result[1].index).deep.equals(['c', 'x']);
    //         expect(result[2].cto).equals(z);
    //         expect(result[2].index).deep.equals(['c', 'z']);
    //     });

    //     it("nested array and object literal", () => {
    //         const contract = /*javascript*/ `let foo = {a:1, b:2, c:3, d:4}; let a,z,d; [a,,{b:z, d}] = [1,2, foo];`;
    //         const { sourceFile } = createTestProject(contract);

    //         const a = createVarDeclCTO(sourceFile, 'a');
    //         const z = createVarDeclCTO(sourceFile, 'z');
    //         const d = createVarDeclCTO(sourceFile, 'd');
    //         const scope = createTestScope(undefined, [a, z, d]);

    //         const expr = sourceFile.forEachChildAsArray()[2]
    //             .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
    //             .getExpressionIfKindOrThrow(tsm.SyntaxKind.BinaryExpression);
    //         const result = pipe(expr.getLeft(), readAssignmentExpression(scope), expectEither, flattenNestedAssignmentBinding);

    //         expect(result).length(3);
    //         expect(result[0].cto).equals(a);
    //         expect(result[0].index).deep.equals([0]);
    //         expect(result[1].cto).equals(z);
    //         expect(result[1].index).deep.equals([2, "b"]);
    //         expect(result[2].cto).equals(d);
    //         expect(result[2].index).deep.equals([2, "d"]);
    //     })
    // })

    describe("element access", () => {
        it("load number indexer", () => {
            const contract = /*javascript*/`const test: number[] = null!; const $VAR = test[1];`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result, testCTO.loadOp, pushInt(1), { kind: 'pickitem' });
        });

        it("load string indexer", () => {
            const contract = /*javascript*/`const test: Map<string, any> = null!; const $VAR = test["test"];`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result, testCTO.loadOp, pushString("test"), { kind: 'pickitem' });
        });

        it("load optional chain", () => {
            const contract = /*javascript*/`const test: ByteString[] = null!; const $VAR = test[1]?.asInteger();`;
            const { project, sourceFile } = createTestProject(contract);
            const globalScope = createTestGlobalScope(project);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(globalScope, testCTO)

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expectResults(result,
                testCTO.loadOp,
                pushInt(1),
                { kind: 'pickitem' },
                { kind: "duplicate" },
                { kind: "isnull" },
                { kind: "jumpif", target: result[13] },
                { kind: 'duplicate'},
                { kind: 'isnull'},
                { kind: 'jumpifnot', offset: 4 },
                { kind: 'drop' },
                pushInt(0),
                { kind: 'jump', offset: 2 },
                { kind: 'convert', type: sc.StackItemType.Integer },
                { kind: 'noop' }
            );
        });

        it("store number indexer", () => {
            const contract = /*javascript*/`const test: number[] = null!; test[1] = 42;`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(init, scope);

            expectResults(result,
                pushInt(42),
                { kind: "duplicate" },
                testCTO.loadOp,
                pushInt(1),
                { kind: 'rotate' },
                { kind: 'setitem' }
            );
        });

        it("store string indexer", () => {
            const contract = /*javascript*/`const test: Map<string, any> = null!; test["test"] = 42;`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(init, scope);

            expectResults(result,
                pushInt(42),
                { kind: "duplicate" },
                testCTO.loadOp,
                pushString("test"),
                { kind: 'rotate' },
                { kind: 'setitem' }
            );
        });
    })

    describe("property access", () => {
        it("load object property", () => {
            const contract = /*javascript*/`const test = { value: 42 }; const $VAR = test.value;`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testInit = test.getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.ObjectLiteralExpression);
            const valueCTO = createTestVariable(testInit.getPropertyOrThrow("value"));

            const testProps = createPropResolvers(valueCTO);
            const testCTO = createTestVariable(test, { properties: testProps });
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(2);
            expect(result[0]).equals(testCTO.loadOp);
            expect(result[1]).equals(valueCTO.loadOp);
        });

        it("optional chaining", () => {
            const contract = /*javascript*/`const test = { value: 42 }; const $VAR = test?.value;`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testInit = test.getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.ObjectLiteralExpression);
            const valueCTO = createTestVariable(testInit.getPropertyOrThrow("value"));

            const testProps = createPropResolvers(valueCTO);
            const testCTO = createTestVariable(test, { properties: testProps });
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(6);
            expect(result[0]).equals(testCTO.loadOp);
            expect(result[1]).equals(valueCTO.loadOp);
            expect(result[2]).deep.equals({ kind: "duplicate" });
            expect(result[3]).deep.equals({ kind: "isnull" });
            expect(result[4]).has.property("kind", "jumpif");
            expect(result[4]).has.property("target", result[5]);
            expect(result[5]).deep.equals({ kind: "noop" });
        });

        it("load type property", () => {
            const contract = /*javascript*/`
                interface Test { value: number; }
                const test:Test = null!;
                const $VAR = test.value;`;
            const { sourceFile } = createTestProject(contract);

            const iTest = sourceFile.getInterfaceOrThrow('Test');
            const iTestType = iTest.getType();
            const value = iTestType.getPropertyOrThrow('value');
            const valueCTO = createTestVariable(value.getValueDeclarationOrThrow());
            const iTestProps = new Map([[value, createPropResolver(valueCTO)]])
            const iTestCTT: CompileTimeType = { type: iTestType, properties: iTestProps };

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(undefined, testCTO, iTestCTT);

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

            const testProps = createPropResolvers(valueCTO);
            const testCTO = createTestVariable(test, { properties: testProps });
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(4);
            expectPushInt(result[0], 42);
            expect(result[1]).deep.equals({ kind: 'duplicate' })
            expect(result[2]).equals(testCTO.loadOp);
            expect(result[3]).equals(valueCTO.storeOp);
        });

        it("store type property", () => {
            const contract = /*javascript*/`
                interface Test { value: number; }
                const test:Test = null!;
                test.value = 42;`;
            const { sourceFile } = createTestProject(contract);

            const iTest = sourceFile.getInterfaceOrThrow('Test');
            const iTestType = iTest.getType();
            const value = iTestType.getPropertyOrThrow('value');
            const valueCTO = createTestVariable(value.getValueDeclarationOrThrow());
            const iTestProps = new Map([[value, createPropResolver(valueCTO)]])
            const iTestCTT: CompileTimeType = { type: iTestType, properties: iTestProps };

            const test = sourceFile.getVariableDeclarationOrThrow('test');
            const testCTO = createTestVariable(test);
            const scope = createTestScope(undefined, testCTO, iTestCTT);

            const init = sourceFile.forEachChildAsArray()[2].asKindOrThrow(tsm.SyntaxKind.ExpressionStatement).getExpression();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(4);
            expectPushInt(result[0], 42);
            expect(result[1]).deep.equals({ kind: 'duplicate' })
            expect(result[2]).equals(testCTO.loadOp);
            expect(result[3]).equals(valueCTO.storeOp);
        });
    })

    describe.skip("constructor", () => {
        // TODO: add tests
    })

    describe("call", () => {
        it("function", () => {
            const contract = /*javascript*/`function test(a: number, b: string) { return 42; } const $VAR = test(42, "hello");`;
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getFunctionOrThrow('test');
            const testCallOp = { kind: 'noop', debug: 'test.call' } as Operation;
            const testCTO = createTestVariable(test, { call: createFunctionInvoker(test, testCallOp) });
            const scope = createTestScope(undefined, testCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(3);
            expectPushData(result[0], "hello");
            expectPushInt(result[1], 42);
            expect(result[2]).equals(testCallOp);
        })

        it("object method", () => {
            const contract = /*javascript*/`
                const obj = { test(a: number, b: string) { return 42; } }; 
                const $VAR = obj.test(42, "hello");`;
            const { sourceFile } = createTestProject(contract);

            const obj = sourceFile.getVariableDeclarationOrThrow('obj');
            const objInit = obj.getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.ObjectLiteralExpression);
            const test = objInit.getPropertyOrThrow('test');
            const testCallOp = { kind: 'noop', debug: 'test.call' } as Operation;
            const testCTO = createTestVariable(test, { call: createFunctionInvoker(test, testCallOp, true) });
            const properties = createPropResolvers(testCTO);
            const objCTO = createTestVariable(obj, { properties });
            const scope = createTestScope(undefined, objCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(4);
            expectPushData(result[0], "hello");
            expectPushInt(result[1], 42);
            expect(result[2]).equals(objCTO.loadOp);
            expect(result[3]).equals(testCallOp);
        })

        it("object static method", () => {
            const contract = /*javascript*/`
                const obj = { test(a: number, b: string) { return 42; } }; 
                const $VAR = obj.test(42, "hello");`;
            const { sourceFile } = createTestProject(contract);

            const obj = sourceFile.getVariableDeclarationOrThrow('obj');
            const objInit = obj.getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.ObjectLiteralExpression);
            const test = objInit.getPropertyOrThrow('test');
            const testCallOp = { kind: 'noop', debug: 'test.call' } as Operation;
            const testCTO = createTestVariable(test, { call: createFunctionInvoker(test, testCallOp, false) });
            const properties = createPropResolvers(testCTO);
            const objCTO = createTestVariable(obj, { properties });
            const scope = createTestScope(undefined, objCTO);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(3);
            expectPushData(result[0], "hello");
            expectPushInt(result[1], 42);
            expect(result[2]).equals(testCallOp);
        })

        it("type method", () => {
            const contract = /*javascript*/`
                interface Test { do(a: number, b: string): number; }
                const obj:Test = null!;
                const $VAR = obj.do(42, "hello");`;
            const { sourceFile } = createTestProject(contract);

            const iTest = sourceFile.getInterfaceOrThrow('Test');
            const iTestType = iTest.getType();
            const doProp = iTestType.getPropertyOrThrow('do');
            const doDecl = doProp.getValueDeclarationOrThrow();
            const doCallOp = { kind: 'noop', debug: 'do.call' } as Operation;
            const doCTO = createTestVariable(doDecl, { call: createFunctionInvoker(doDecl, doCallOp, true) });
            const iTestProps = new Map([[doProp, createPropResolver(doCTO)]])
            const iTestCTT: CompileTimeType = { type: iTestType, properties: iTestProps };

            const obj = sourceFile.getVariableDeclarationOrThrow('obj');
            const objCTO = createTestVariable(obj);
            const scope = createTestScope(undefined, objCTO, iTestCTT);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(4);
            expectPushData(result[0], "hello");
            expectPushInt(result[1], 42);
            expect(result[2]).equals(objCTO.loadOp);
            expect(result[3]).equals(doCallOp);
        })


        it("type static method", () => {
            const contract = /*javascript*/`
                interface Test { do(a: number, b: string): number; }
                const obj:Test = null!;
                const $VAR = obj.do(42, "hello");`;
            const { sourceFile } = createTestProject(contract);

            const iTest = sourceFile.getInterfaceOrThrow('Test');
            const iTestType = iTest.getType();
            const doProp = iTestType.getPropertyOrThrow('do');
            const doDecl = doProp.getValueDeclarationOrThrow();
            const doCallOp = { kind: 'noop', debug: 'do.call' } as Operation;
            const doCTO = createTestVariable(doDecl, { call: createFunctionInvoker(doDecl, doCallOp) });
            const iTestProps = new Map([[doProp, createPropResolver(doCTO)]])
            const iTestCTT: CompileTimeType = { type: iTestType, properties: iTestProps };

            const obj = sourceFile.getVariableDeclarationOrThrow('obj');
            const objCTO = createTestVariable(obj);
            const scope = createTestScope(undefined, objCTO, iTestCTT);

            const init = sourceFile.getVariableDeclarationOrThrow('$VAR').getInitializerOrThrow();
            const result = testParseExpression(init, scope);

            expect(result).lengthOf(3);
            expectPushData(result[0], "hello");
            expectPushInt(result[1], 42);
            expect(result[2]).equals(doCallOp);
        })
    });
});
