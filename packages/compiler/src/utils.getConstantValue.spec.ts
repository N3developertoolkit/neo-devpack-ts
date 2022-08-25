import { expect } from 'chai';
import 'mocha';
import * as tsm from "ts-morph";
import { createTestProject } from './scope.spec';
import { getConstantValue } from './utils';

describe("getConstantValue", () => {
    async function runTest(expected: string) {
        const { sourceFile } = await createTestProject(`const value = ${expected};`)
        const stmt = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        return getConstantValue(stmt.getDeclarations()[0]);
    }

    it("var statement", async () => {
        const { sourceFile } = await createTestProject(`var value = "test";`)
        const stmt = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        const actual = getConstantValue(stmt.getDeclarations()[0]);
        expect(actual).undefined;
    });
    it("let statement", async () => {
        const { sourceFile } = await createTestProject(`let value = "test";`)
        const stmt = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        const actual = getConstantValue(stmt.getDeclarations()[0]);
        expect(actual).undefined;
    });

    it("numeric literal", async () => {
        const expected = 123n;
        const value = await runTest(`${expected}`);
        expect(value).eq(expected);
    });
    it("bigint literal", async () => {
        const expected = 123n;
        const value = await runTest(`${expected}n`);
        expect(value).eq(expected);
    });
    it("true literal", async () => {
        const expected = true;
        const value = await runTest(`${expected}`);
        expect(value).eq(expected);
    });
    it("false literal", async () => {
        const expected = false;
        const value = await runTest(`${expected}`);
        expect(value).eq(expected);
    });
    it("null literal", async () => {
        const value = await runTest("null");
        expect(value).null;
    });
    it("string literal", async () => {
        const expected = "Hello, World!";
        const value = await runTest(`"${expected}"`);
        expect(value).eql(Buffer.from(expected, 'utf8'));
    });
})