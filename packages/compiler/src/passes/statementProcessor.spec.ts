import { instance, mock, when, verify } from 'ts-mockito';
import 'mocha';
import * as tsm from "ts-morph";
import { MethodBuilder } from './MethodBuilder';
import { processBlock, processReturnStatement } from './statementProcessor';
import { ConstantSymbolDef, ReadonlyScope } from '../scope';
import { createTestProject } from '../scope.spec';
import { syncBuiltinESMExports } from 'module';

describe("statementProcessor", () => {
    const builder = new MethodBuilder();

    it("processBlock", async () => {
        const js = /*javascript*/`function test() { }`;
        const { sourceFile } = await createTestProject(js)
        const block = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.Block);
        const scopeMock = mock<ReadonlyScope>();
        const scope = instance(scopeMock);

        processBlock(block, { builder, scope });
        // TODO: validate builder contents
    })

    it("processReturnStatement value", async () => {
        const js = /*javascript*/`const VALUE = 42n; function test() { return VALUE; }`;
        const { sourceFile } = await createTestProject(js)
        const _return = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.ReturnStatement);
        const symbol = _return.getExpressionIfKindOrThrow(tsm.SyntaxKind.Identifier).getSymbolOrThrow();
        const constDef = new ConstantSymbolDef(symbol, null!, BigInt(42));

        const scopeMock = mock<ReadonlyScope>();
        when(scopeMock.resolve(symbol)).thenReturn(constDef);
        const scope = instance(scopeMock);

        processReturnStatement(_return, { builder, scope });
        // TODO: validate builder contents
    })

    it("processReturnStatement no value", async () => {
        const js = /*javascript*/`function test() { return; }`;
        const { sourceFile } = await createTestProject(js)
        const _return = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.ReturnStatement);
        const scopeMock = mock<ReadonlyScope>();
        const scope = instance(scopeMock);

        processReturnStatement(_return, { builder, scope });
        // TODO: validate builder contents
    })
})