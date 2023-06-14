import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as O from 'fp-ts/Option';
import { createTestProject, expectEither, createVarDeclCTO, expectPushInt } from './testUtils.spec';
import { Operation, pushInt } from '../src/types/Operation';
import { ParsedConstant, ParsedVariable, isParsedConstant, isVariableBinding, parseVariableBinding } from '../src/passes/parseVariableBinding';

describe("parse variable declarations", () => {
    describe("identifier binding", () => {

        it("const int", () => {
            const contract = /*javascript*/ `const test = 42;`
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow("test");

            const result = expectEither(parseVariableBinding(test, tsm.VariableDeclarationKind.Const, O.of(pushInt(42))))

            expect(result).length(1);
            expectParsedConstant(result[0], test.getNameNode(), pushInt(42));
        })

        it("const variable", () => {
            const contract = /*javascript*/ `const account: ByteString = null!; const test = account;`
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow("test");
            const account = createVarDeclCTO(sourceFile, 'account');

            const result = expectEither(parseVariableBinding(test, tsm.VariableDeclarationKind.Const, O.of(account.loadOp)))

            expect(result).length(1);
            expectVarBinding(result[0], test.getNameNode(), []);
        })



        it("let int", () => {
            const contract = /*javascript*/ `let test = 42;`
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow("test");

            const result = expectEither(parseVariableBinding(test,tsm.VariableDeclarationKind.Let, O.of(pushInt(42))))

            expect(result).length(1);
            expectVarBinding(result[0], test.getNameNode(), []);
        })
    })

    it("array binding", () => {

        const contract = /*javascript*/ `const [a,,c] = [1,2,3];`
        const { sourceFile } = createTestProject(contract);

        const decl = sourceFile.getVariableStatements()[0].getDeclarations()[0];
        const binding = decl.getNameNode().asKindOrThrow(tsm.SyntaxKind.ArrayBindingPattern);

        const a = binding.getElements()[0]
            .asKindOrThrow(tsm.SyntaxKind.BindingElement)
            .getNameNode()
            .asKindOrThrow(tsm.SyntaxKind.Identifier);
        const c = binding.getElements()[2]
            .asKindOrThrow(tsm.SyntaxKind.BindingElement)
            .getNameNode()
            .asKindOrThrow(tsm.SyntaxKind.Identifier);

        const result = expectEither(parseVariableBinding(decl, tsm.VariableDeclarationKind.Const, O.none));

        expect(result).length(2);
        expectVarBinding(result[0], a, [0]);
        expectVarBinding(result[1], c, [2]);
    });

    it("object binding", () => {
        const contract = /*javascript*/`let foo = {a:1, b:2, c:3, d:4}; const { a, c:z, d} = foo; `;
        const { sourceFile } = createTestProject(contract);

        const decl = sourceFile.getVariableStatements()[1].getDeclarations()[0];
        const binding = decl.getNameNode().asKindOrThrow(tsm.SyntaxKind.ObjectBindingPattern);
        const elems = binding.getElements()
            .map(e => e.getNameNode().asKindOrThrow(tsm.SyntaxKind.Identifier));

        const result = expectEither(parseVariableBinding(decl, tsm.VariableDeclarationKind.Const, O.none));

        expect(result).length(3);
        expectVarBinding(result[0], elems[0], ["a"])
        expectVarBinding(result[1], elems[1], ["c"])
        expectVarBinding(result[2], elems[2], ["d"])
    });

    function expectVarBinding(v: ParsedVariable, node: tsm.BindingName, index: readonly (string | number)[]) {
        if (isVariableBinding(v)) {
            expect(v.node).equals(node);
            expect(v.symbol).equals(node.getSymbolOrThrow());
            expect(v.index).deep.equals(index);
        } else {
            expect.fail("expected variable binding");
        }
    }

    function expectParsedConstant(v: ParsedVariable, node: tsm.BindingName, operation: Operation) {
        if (isParsedConstant(v)) {
            expect(v.node).equals(node);
            expect(v.symbol).equals(node.getSymbolOrThrow());
            expect(v.constant).deep.equals(operation);
        } else {
            expect.fail("expected parsed constant");
        }
    }
});