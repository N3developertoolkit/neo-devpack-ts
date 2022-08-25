import { expect } from 'chai';
import 'mocha';
import * as tsm from "ts-morph";
import { createContractProject } from './utils';
import { ConstantSymbolDef, createGlobalScope, FunctionSymbolDef, getConstantValue } from './compiler';

export async function createTestProject(source: string) {
    const project = await createContractProject();
    const sourceFile = project.createSourceFile("contract.ts", source);
    return { project, sourceFile };
}

export function getSymbols(node: tsm.Node): ReadonlyMap<string, tsm.Symbol> {
    const set = new Set<tsm.Symbol>();
    const nodeSymbol = node.getSymbol();
    if (nodeSymbol) { set.add(nodeSymbol); }
    node.forEachDescendant((n, t) => {
        const s = n.getSymbol();
        if (s) { set.add(s); }
    })

    const map = new Map<string, tsm.Symbol>();
    for (const s of set) {
        map.set(s.getName(), s);
    }
    return map;
}

describe("createGlobalScope", () => {
    it("const int", async () => {
        const src = `const intValue = 0x01;`;

        const { project, sourceFile } = await createTestProject(src)
        const symbolMap = getSymbols(sourceFile);

        const globals = createGlobalScope(project);

        const actual = globals.resolve(symbolMap.get("intValue")!);
        expect(actual).not.undefined;
        expect(actual).instanceof(ConstantSymbolDef);
        expect((actual as ConstantSymbolDef).value).eq(1n);
    });

    it ("function def", async () => {
        const src = `function test() { return "hello world"; }`;

        const { project, sourceFile } = await createTestProject(src)
        const symbolMap = getSymbols(sourceFile);

        const globals = createGlobalScope(project);

        const actual = globals.resolve(symbolMap.get("test")!);
        expect(actual).not.undefined;
        expect(actual).instanceof(FunctionSymbolDef);
    })
})
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