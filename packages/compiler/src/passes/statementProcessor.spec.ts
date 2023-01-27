import { instance, mock, when, verify } from 'ts-mockito';
import 'mocha';
import * as tsm from "ts-morph";
import { MethodBuilder } from './MethodBuilder';
import { processBlock, processReturnStatement, processVariableStatement } from './statementProcessor';
import { ConstantSymbolDef, ReadonlyScope, Scope, SymbolDef } from '../scope';
import { createTestProject } from '../scope.spec';

class FakeScope implements Scope {
    
    readonly parentScope = undefined;
    
    define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T {
        return typeof factory === 'function' ? factory(this) : factory;
    }

    get symbols(): IterableIterator<SymbolDef> {
        throw new Error('Method not implemented.');
    }
    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        throw new Error('Method not implemented.');
    }
}

describe("statementProcessor", () => {

    it("processBlock", async () => {
        const builder = new MethodBuilder(0);
        const js = /*javascript*/`function test() { }`;
        const { sourceFile } = await createTestProject(js)
        const block = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.Block);
        const scopeMock = mock<ReadonlyScope>();
        const scope = instance(scopeMock);

        processBlock(block, { builder, scope });
        // TODO: validate builder contents
    })

    it("processReturnStatement value", async () => {
        const builder = new MethodBuilder(0);
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
        const builder = new MethodBuilder(0);
        const js = /*javascript*/`function test() { return; }`;
        const { sourceFile } = await createTestProject(js)
        const stmt = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.ReturnStatement);
        const scopeMock = mock<ReadonlyScope>();
        const scope = instance(scopeMock);

        processReturnStatement(stmt, { builder, scope });
        // TODO: validate builder contents
    })

    it("processVariableStatement literal", async () => {
        const builder = new MethodBuilder(0);
        const js = /*javascript*/`function test() { const foo = 12; }`;
        const { sourceFile } = await createTestProject(js)
        const stmt = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        const scope = new FakeScope();

        processVariableStatement(stmt, { builder, scope });
        // TODO: validate builder contents
    })

    it("processVariableStatement identifier", async () => {
        const builder = new MethodBuilder(0);
        const js = /*javascript*/`const VALUE = 12; function test() { const foo = VALUE; }`;
        const { sourceFile } = await createTestProject(js)
        const symbol = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement)
            .getDeclarations()[0].getSymbolOrThrow();

        const stmt = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        const scope = new FakeScope();
        scope.define(s => new ConstantSymbolDef(symbol, s, 12n));

        processVariableStatement(stmt, { builder, scope });
        // TODO: validate builder contents
    })
})