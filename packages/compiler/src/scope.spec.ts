import { expect } from 'chai';
import 'mocha';
import * as tsm from "ts-morph";
import { createContractProject } from './utils';
import { ConstantSymbolDef, createGlobalScope, FunctionSymbolDef, ParameterSymbolDef, ReadonlyScope, SymbolDef } from './scope';
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
    project.resolveSourceFileDependencies();
    return { project, sourceFile };
}

export function getSymbol(node: tsm.Node, name: string) {
    const symbol = node.forEachDescendant(n => {
        const symbol = n.getSymbol();
        if (symbol && symbol.getName() === name) {
            return symbol;
        }
    });
    if (symbol) { return symbol; }
    else { throw new Error(`Failed to find ${name} symbol`) }
}

function testScope<T extends SymbolDef>(scope: ReadonlyScope, symbol: tsm.Symbol, ctor: new (...args: any) => T): T {
    const resolved = scope.resolve(symbol);

    expect(resolved).not.undefined;
    expect(resolved).instanceOf(ctor);
    expect(resolved!.symbol).eq(symbol)
    expect(resolved!.parentScope).eq(scope);

    return resolved as T;
}

describe("createGlobalScope", () => {
    it("const variable statement", async () => {
        const src = `const intValue = 42;`;

        const { project, sourceFile } = await createTestProject(src)
        const globals = createGlobalScope(project);

        const constDef = testScope(globals, getSymbol(sourceFile, "intValue"), ConstantSymbolDef);
        expect(constDef.value).eq(42n);
    });


    it ("function def", async () => {
        const src = `function test(a: bigint, b: boolean) { return "hello world"; }`;

        const { project, sourceFile } = await createTestProject(src)

        const globals = createGlobalScope(project);
        const funcDef = testScope(globals, getSymbol(sourceFile, "test"), FunctionSymbolDef);

        const p1Def = testScope(funcDef, getSymbol(funcDef.node, "a"), ParameterSymbolDef);
        expect(p1Def.index).eq(0);

        const p2Def = testScope(funcDef, getSymbol(funcDef.node, "b"), ParameterSymbolDef);
        expect(p2Def.index).eq(1);
    })
})
