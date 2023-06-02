import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';
import { createTestProject, expectEither, createVarDeclCTO, expectPushInt } from './testUtils.spec';
import { pushInt } from '../src/types/Operation';
import { parseVariableBinding } from '../src/passes/parseVariableBinding';

describe("parse variable declarations", () => {
    describe("identifier binding", () => {

        it("const int", () => {
            const contract = /*javascript*/ `const test = 42;`
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow("test");

            const result = expectEither(parseVariableBinding(test, tsm.VariableDeclarationKind.Const, ROA.of(pushInt(42))))

            expect(result).length(1);
            expect(result[0].node).equals(test.getNameNode());
            expect(result[0].symbol).equals(test.getSymbolOrThrow());
            expect(result[0].index).is.undefined;
            expectPushInt(result[0].constant!, 42);
        })

        it("const variable", () => {
            const contract = /*javascript*/ `const account: ByteString = null!; const test = account;`
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow("test");
            const account = createVarDeclCTO(sourceFile, 'account');

            const result = expectEither(parseVariableBinding(test, tsm.VariableDeclarationKind.Const, account.loadOps))

            expect(result).length(1);
            expect(result[0].node).equals(test.getNameNode());
            expect(result[0].symbol).equals(test.getSymbolOrThrow());
            expect(result[0].index).is.undefined;
            expect(result[0].constant).is.undefined;
        })

        it("let int", () => {
            const contract = /*javascript*/ `let test = 42;`
            const { sourceFile } = createTestProject(contract);

            const test = sourceFile.getVariableDeclarationOrThrow("test");

            const result = expectEither(parseVariableBinding(test, tsm.VariableDeclarationKind.Let, ROA.of(pushInt(42))))

            expect(result).length(1);
            expect(result[0].node).equals(test.getNameNode());
            expect(result[0].symbol).equals(test.getSymbolOrThrow());
            expect(result[0].index).is.undefined;
            expect(result[0].constant).is.undefined;
        })
    })

    it("array binding", () => {

        const contract = /*javascript*/ `let [a,,c] = [1,2,3];`
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

        const result = expectEither(parseVariableBinding(decl, tsm.VariableDeclarationKind.Let, ROA.empty));

        expect(result).length(2);
        expect(result[0].index).equals(0);
        expect(result[0].node).equals(a);
        expect(result[0].constant).undefined;
        expect(result[1].index).equals(2);
        expect(result[1].node).equals(c);
        expect(result[1].constant).undefined;
    });

    it("object binding", () => {
        const contract = /*javascript*/`let foo = {a:1, b:2, c:3, d:4}; let { a, c:z, d} = foo; `;
        const { sourceFile } = createTestProject(contract);

        const decl = sourceFile.getVariableStatements()[1].getDeclarations()[0];
        const binding = decl.getNameNode().asKindOrThrow(tsm.SyntaxKind.ObjectBindingPattern);
        const elems = binding.getElements()
            .map(e => [e.getNameNode().asKindOrThrow(tsm.SyntaxKind.Identifier), e.getPropertyNameNode()] as const);

        const result = expectEither(parseVariableBinding(decl, tsm.VariableDeclarationKind.Let, ROA.empty));

        expect(result).length(3);
        result.forEach((r, i) => {
            const [id, prop] = elems[i];
            expect(r.node).equals(id);
            expect(r.constant).undefined;
            expect(r.index).equals(prop ? prop.getText() : id.getText());
        });
    });
});