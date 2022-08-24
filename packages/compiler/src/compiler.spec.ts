import { expect } from 'chai';
import 'mocha';
import { createContractProject } from './utils';
import * as tsm from "ts-morph";
import { getConstantValue } from './compiler';
import { stringify } from 'querystring';

async function createTestProject(source: string) {
    const project = await createContractProject();
    const sourceFile = project.createSourceFile("contract.ts", source);
    return {project, sourceFile};
}

describe("getConstantValue", () => {
    async function runTest(expected: string) {
        const {sourceFile} = await createTestProject(`const value = ${expected};`)
        const stmt = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        return getConstantValue(stmt.getDeclarations()[0]);
    }

    it("var statement", async () => {
        const {sourceFile} = await createTestProject(`var value = "test";`)
        const stmt = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        const actual = getConstantValue(stmt.getDeclarations()[0]);
        expect(actual).is.undefined;
    });
    it("let statement", async () => {
        const {sourceFile} = await createTestProject(`let value = "test";`)
        const stmt = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        const actual = getConstantValue(stmt.getDeclarations()[0]);
        expect(actual).is.undefined;
    });

    it("numeric literal", async () => {
        const expected = 123n;
        const value = await runTest(`${expected}`);
        expect(value).is.eq(expected);
    });
    it("bigint literal", async () => {
        const expected = 123n;
        const value = await runTest(`${expected}n`);
        expect(value).is.eq(expected);
    });
    it("true literal", async () => {
        const expected = true;
        const value = await runTest(`${expected}`);
        expect(value).is.eq(expected);
    });
    it("false literal", async () => {
        const expected = false;
        const value = await runTest(`${expected}`);
        expect(value).is.eq(expected);
    });
    it("null literal", async () => {
        const value = await runTest("null");
        expect(value).is.null;
    });
    it("string literal", async () => {
        const expected = "Hello, World!";
        const value = await runTest(`"${expected}"`);
        expect(value).is.eql(Buffer.from(expected, 'utf8'));
    });
})