import { expect } from 'chai';
import { identity, pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import { parseExpression } from '../src/passes/expressionProcessor';
import { createEmptyScope } from '../src/types/CompileTimeObject';
import { createTestProject, testParseExpression } from "./testUtils.spec";

describe("expression parser", () => {
    describe("literal", () => {

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

    // describe("identifier", () => {
    //     const contract = /*javascript*/`function testFunc(someParam: string) { const value = someParam; }`;
    //     const { sourceFile } = createTestProject(contract);
    //     const func = sourceFile.getFunctionOrThrow('testFunc');
    //     const param = func.getParameters()[0];
    //     const cto: CompileTimeObject = {
    //         node: param,
    //         symbol: param.getSymbolOrThrow(),
    //         loadOps: [{ kind: 'noop', debug: 'someParam.load' } as Operation],
    //         storeOps: [{ kind: 'noop', debug: 'someParam.store' } as Operation]
    //     }
    //     const scope = pipe(
    //         updateScope(createEmptyScope())(cto, undefined),
    //         E.match(expect.fail, identity)
    //     )
    //     const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();
    //     const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
    //     expect(tree).instanceOf(IdentifierExpressionTree);
    //     const $tree = tree as IdentifierExpressionTree;
    //     expect($tree.symbol.getName()).eq("someParam");
    //     it("load", () => {
    //         expect(tree.load).to.exist;
    //         const actual = pipe(scope, tree.load!, E.match(error => expect.fail(error.message), identity));
    //         expect(actual).eq(cto.loadOps);
    //     });
    //     it("store", () => {
    //         expect(tree.store).to.exist;
    //         const actual = pipe(scope, tree.store!, E.match(error => expect.fail(error.message), identity));
    //         expect(actual).eq(cto.storeOps);
    //     })
    //     // it("resolve", () => {
    //     //     // expect(tree.resolve).to.exist;
    //     //     const actual = pipe(scope, tree.resolve!, E.match(error => expect.fail(error.message), identity));
    //     //     expect(actual).eq(cto);
    //     // })
    // });
    // describe("call expression", () => {
    //     it("checkWitness", () => {
    //         const contract = /*javascript*/`function testFunc(owner: ByteString) { const value = checkWitness(owner); }`;
    //         const { project, sourceFile } = createTestProject(contract);
    //         const func = sourceFile.getFunctionOrThrow('testFunc');
    //         const ownerSymbol = func.getSymbolsInScope(tsm.ts.SymbolFlags.Variable).find(s => s.getName() === 'owner');
    //         if (!ownerSymbol) expect.fail("owner not found");
    //         const cto: CompileTimeObject = {
    //             node: ownerSymbol.getDeclarations()[0],
    //             symbol: ownerSymbol,
    //             loadOps: [{ kind: 'noop', debug: 'owner.load' } as Operation],
    //             storeOps: [{ kind: 'noop', debug: 'owner.store' } as Operation]
    //         }
    //         const globalScope = createTestGlobalScope(project);
    //         const scope = pipe([cto], createScope(globalScope), E.match(expect.fail, identity));
    //         const init = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[0].getInitializerOrThrow();
    //         const tree = pipe(init, parseExpressionTree, E.match(error => expect.fail(error.message), identity));
    //         expect(tree.load).to.exist;
    //     });
    // });
});
