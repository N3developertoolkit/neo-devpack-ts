import { expect } from 'chai';
import { instance, mock, when, verify } from 'ts-mockito';
import 'mocha';
import * as tsm from "ts-morph";
import { MethodBuilder } from './MethodBuilder';
import { ConstantSymbolDef, ReadonlyScope, SymbolDef } from '../scope';
import { processIdentifier, processSymbolDef } from './expressionProcessor';
import { ProcessOptions } from './processFunctionDeclarations';
import { createTestProject } from '../testUtils';

function testScope(def: SymbolDef): ReadonlyScope {
    const scope = mock<ReadonlyScope>();
    when(scope.resolve(def.symbol)).thenReturn(def);
    return instance(scope);
}
describe("processSymbolDef", () => {
    const builder: MethodBuilder = mock(MethodBuilder);
    const options: ProcessOptions = {
        builder: instance(builder),
        scope: null!
    };

    it("null constant", () => {
        const def = new ConstantSymbolDef(null!, null!, null);
        processSymbolDef(def, options);
        verify(builder.pushNull()).once();
    });

    it("boolean constant", () => {
        const def = new ConstantSymbolDef(null!, null!, true);
        processSymbolDef(def, options);
        verify(builder.pushBoolean(true)).once();
    });

    it("bigint constant", () => {
        const value = BigInt(42);
        const def = new ConstantSymbolDef(null!, null!, value);
        processSymbolDef(def, options);
        verify(builder.pushInt(value)).once();
    });

    it("data constant", () => {
        const value = new Uint8Array([1, 2, 3, 4, 5]);
        const def = new ConstantSymbolDef(null!, null!, value);
        processSymbolDef(def, options);
        verify(builder.pushData(value)).once();
    });

});

describe("expressionProcessor", () => {
    const builder: MethodBuilder = mock(MethodBuilder);

    it("processIdentifier", async () => {

        const js = /*javascript*/`const SYMBOL; return SYMBOL;`;

        var { sourceFile } = await createTestProject(js);
        const retStmt = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.ReturnStatement);
        const idExpr = retStmt.getExpressionIfKindOrThrow(tsm.SyntaxKind.Identifier);
        const constDef = new ConstantSymbolDef(idExpr.getSymbolOrThrow(), null!, BigInt(42));

        processIdentifier(idExpr, {
            builder: instance(builder),
            scope: testScope(constDef)
        });
        verify(builder.pushInt(BigInt(42))).once();
    });

})