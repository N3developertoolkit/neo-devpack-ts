import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";
import { createTestProject, expectEither } from './testUtils.spec';
import { NestedVariableBindings, IdentifierBinding, flattenNestedVaribleBinding, isIdentifierBinding, readNestedVariableBinding } from '../src/passes/parseVariableBinding';
import { pipe } from 'fp-ts/lib/function';

describe("read Variable Binding", () => {
    it("identifier declaration", () => {
        const contract = /*javascript*/ `const test = 42;`
        const { sourceFile } = createTestProject(contract);

        const decl = sourceFile.getVariableDeclarationOrThrow("test");

        let result = pipe(decl.getNameNode(), readNestedVariableBinding, expectEither);
        expect(isIdentifierBinding(result)).true;
        result = result as IdentifierBinding;
        expect(result.node).equals(decl.getNameNode());
        expect(result.symbol).equals(decl.getSymbolOrThrow());
    })

    // it("identifier assignment", () => {
    //     const contract = /*javascript*/ `let test = 42; test = 43;`
    //     const { sourceFile } = createTestProject(contract);

    //     const decl = sourceFile.getVariableDeclarationOrThrow("test");
    //     const expr = sourceFile.forEachChildAsArray()[1]
    //         .asKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
    //         .getExpressionIfKindOrThrow(tsm.SyntaxKind.BinaryExpression);

    //     let result = pipe(expr.getLeft(), readNestedVariableBinding, expectEither);
    //     expect(isIdentifierBinding(result)).true;
    //     result = result as IdentifierBinding;
    //     expect(result.node).equals(expr.getLeft());
    //     expect(result.symbol).equals(decl.getNameNode().getSymbolOrThrow());
    // })

    it("array binding declaration", () => {
        const contract = /*javascript*/ `const [a,b,,d] = [1,2,3,4];`
        const { sourceFile } = createTestProject(contract);

        const decl = sourceFile.forEachChildAsArray()[0]
            .asKindOrThrow(tsm.SyntaxKind.VariableStatement)
            .getDeclarations()[0];
        const elements = decl.getNameNode()
            .asKindOrThrow(tsm.SyntaxKind.ArrayBindingPattern)
            .getElements();
        const a = (elements[0] as tsm.BindingElement).getNameNode().asKindOrThrow(tsm.SyntaxKind.Identifier);
        const b = (elements[1] as tsm.BindingElement).getNameNode().asKindOrThrow(tsm.SyntaxKind.Identifier);
        const d = (elements[3] as tsm.BindingElement).getNameNode().asKindOrThrow(tsm.SyntaxKind.Identifier);

        let result = pipe(decl.getNameNode(), readNestedVariableBinding, expectEither);
        expect(isIdentifierBinding(result)).false;
        expect(result).deep.equals([
            [{ node: a, symbol: a.getSymbolOrThrow() }, 0],
            [{ node: b, symbol: b.getSymbolOrThrow() }, 1],
            [{ node: d, symbol: d.getSymbolOrThrow() }, 3],
        ]);
    })

    it("object binding declaration", () => {
        const contract = /*javascript*/`let foo = {a:1, b:2, c:3, d:4}; let { a, c:z, d} = foo; `;
        const { sourceFile } = createTestProject(contract);

        const decl = sourceFile.getVariableStatements()[1].getDeclarations()[0];
        const binding = decl.getNameNode().asKindOrThrow(tsm.SyntaxKind.ObjectBindingPattern);
        const expected = binding.getElements();
        const expectedIndexes = ['a', 'c', 'd'];
        expect(expected).lengthOf(expectedIndexes.length);

        let result = pipe(decl.getNameNode(), readNestedVariableBinding, expectEither);
        expect(isIdentifierBinding(result)).false;
        result = result as NestedVariableBindings;
        expect(result).lengthOf(expectedIndexes.length);
        for (const i in result) {
            let [actual, index] = result[i];
            expect(index).equals(expectedIndexes[i]);
            expect(isIdentifierBinding(actual)).true;
            actual = actual as IdentifierBinding;
            expect(actual.node).equals(expected[i].getNameNode());
            expect(actual.symbol).equals(expected[i].getSymbolOrThrow());
        }
    });

    it("nested", () => {
        const contract = /*javascript*/`const o = {a: 'a', b: 'b', c: [1,2,3]}; const {a, c: [d, , e]} = o;`;
        const { sourceFile } = createTestProject(contract);
        const children = sourceFile.forEachChildAsArray();
        const decl = children[1].asKindOrThrow(tsm.SyntaxKind.VariableStatement).getDeclarations()[0];

        let result = pipe(decl.getNameNode(), readNestedVariableBinding, expectEither);
        const flat = flattenNestedVaribleBinding(result);
        
        // TODO: add verification 

    })

    it("nested2", () => {
        const contract = /*javascript*/`const o = [[1,2,3], [4,5,6]]; const [a, , [,e,f]] = o;`;
        const { sourceFile } = createTestProject(contract);
        const children = sourceFile.forEachChildAsArray();
        const decl = children[1].asKindOrThrow(tsm.SyntaxKind.VariableStatement).getDeclarations()[0];

        let result = pipe(decl.getNameNode(), readNestedVariableBinding, expectEither);
        const flat = flattenNestedVaribleBinding(result);
        
        // TODO: add verification 

    })
});
