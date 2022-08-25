import { expect } from 'chai';
import 'mocha';
import * as tsm from "ts-morph";
import { createContractProject, getConstantValue } from './utils';
import { ConstantSymbolDef, createGlobalScope, FunctionSymbolDef } from './scope';
import path from 'path';
import fs from 'fs/promises';
import { AsyncLazy } from './utility/Lazy';

const scfx = new AsyncLazy(async () => {
    const scfxPath = path.join(__dirname, "../../framework/src/index.d.ts");
    return await fs.readFile(scfxPath, 'utf8');
})

export async function createTestProject(source: string) {
    const scfxSrc = await scfx.get();
    const project = await createContractProject(scfxSrc);
    const sourceFile = project.createSourceFile("contract.ts", source);
    return { project, sourceFile };
}

// note, this function will only save the last symbol with a given name
export function getSymbols(node: tsm.Node): ReadonlyMap<string, tsm.Symbol> {
    const map = new Map<string, tsm.Symbol>();
    add(node);
    node.forEachDescendant((n,t) => add(n));
    return map;

    function add(node: tsm.Node) {
        const symbol = node.getSymbol();
        if (symbol) {
            map.set(symbol.getName(), symbol);
        }
    }
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
