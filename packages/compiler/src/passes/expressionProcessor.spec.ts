import { instance, mock, when } from 'ts-mockito';
import 'mocha';
import * as tsm from "ts-morph";
import { ConstantSymbolDef, ReadonlyScope, SymbolDef } from '../scope';
import { createTestProject } from '../scope.spec'
import { assert, expect } from 'chai';
import { Operation } from '../types/Operation';
import { DiagnosticResult, parseArrayLiteral, parseBinaryExpression, parseStringLiteral } from './expressionProcessor';
import * as E from "fp-ts/lib/Either";

export function testScope(def: SymbolDef): ReadonlyScope {
    const scope = mock<ReadonlyScope>();
    when(scope.resolve(def.symbol)).thenReturn(def);
    return instance(scope);
}

function failDiag(diag: tsm.ts.Diagnostic): never {
    const msg = typeof diag.messageText == 'string'
        ? diag.messageText
        : diag.messageText.messageText;
    assert.fail(msg);
}

function expectOk<T>(result: DiagnosticResult<T>): T {
    if (E.isLeft(result)) failDiag(result.left);
    else return result.right;
}

class TestScope implements ReadonlyScope {

    private readonly map = new Map<tsm.Symbol, SymbolDef>();
    readonly parentScope: ReadonlyScope | undefined;

    constructor(parentScope?: ReadonlyScope) {
        this.parentScope = parentScope;
    }

    get symbols(): IterableIterator<SymbolDef> {
        return this.map.values();
    }

    resolve(symbol?: tsm.Symbol): SymbolDef | undefined {
        if (symbol) {
            return this.map.get(symbol) ?? this.parentScope?.resolve(symbol);
        }
        return undefined;
    }

    define(def: SymbolDef) {
        this.map.set(def.symbol, def);
    }
}

describe("parseIdentifier", () => {
    it("ConstantSymbolDef", () => {
        const js = /*javascript*/`function test() { const varname = 42n; return varname;}`;
        const { sourceFile } = createTestProject(js)
        const node = sourceFile.getDescendantsOfKind(tsm.SyntaxKind.Identifier).slice(-1)[0];
        const scope = new TestScope();
        scope.define(new ConstantSymbolDef(node.getSymbolOrThrow(), 42n));
        // const result = expectOk(parseIdentifier(node, scope));
    });
})

describe("expression parser", () => {
    it("parseStringLiteral", () => {

        const js = /*javascript*/`function test() { return "Hello World";}`;
        const { sourceFile } = createTestProject(js)
        const node = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.StringLiteral);
        const result = expectOk(parseStringLiteral(node));




    });

    it("parseArrayLiteral", () => {
        const js = /*javascript*/`function test() { return [1,2,3,4,5]; }`;
        const { sourceFile } = createTestProject(js)
        const node = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.ArrayLiteralExpression);
        const scope = new TestScope();
        const result = expectOk(parseArrayLiteral(node, scope));

    });

    it("parseBinary", () => {
        const js = /*javascript*/`function test() { return 1 + 2; }`;
        const { sourceFile } = createTestProject(js)
        const node = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.BinaryExpression);
        const scope = new TestScope();
        const result = expectOk(parseBinaryExpression(node, scope));
    });

    it("parseCall", () => {
        const js = /*javascript*/`function test() { return storageGetContext(); }`;
        const { sourceFile } = createTestProject(js)
        const node = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.CallExpression);
        const scope = new TestScope();
        // const result = expectOk(parseCallExpression(node, scope));
    })

    // const builderMock: MethodBuilder = mock(MethodBuilder);
    // const builder = instance(builderMock);

    // it("processIdentifier", () => {

    //     const symbol = instance(mock(tsm.Symbol));
    //     const constDef = new ConstantSymbolDef(symbol, null!, BigInt(42));
    //     const options = testOptions(builder, constDef);

    //     const idExprMock = mock(tsm.Identifier);
    //     when(idExprMock.getSymbol()).thenReturn(symbol);

    //     processIdentifier(instance(idExprMock), options);
    //     verify(builderMock.pushInt(BigInt(42))).once();
    // });

    // describe("processSymbolDef", () => {
    //     const builder: MethodBuilder = mock(MethodBuilder);
    //     const options: ProcessOptions = {
    //         builder: instance(builder),
    //         scope: null!
    //     };

    //     it("null constant", () => {
    //         const def = new ConstantSymbolDef(null!, null!, null);
    //         processSymbolDef(def, options);
    //         verify(builder.pushNull()).once();
    //     });

    //     it("boolean constant", () => {
    //         const def = new ConstantSymbolDef(null!, null!, true);
    //         processSymbolDef(def, options);
    //         verify(builder.pushBoolean(true)).once();
    //     });

    //     it("bigint constant", () => {
    //         const value = BigInt(42);
    //         const def = new ConstantSymbolDef(null!, null!, value);
    //         processSymbolDef(def, options);
    //         verify(builder.pushInt(value)).once();
    //     });

    //     it("data constant", () => {
    //         const value = new Uint8Array([1, 2, 3, 4, 5]);
    //         const def = new ConstantSymbolDef(null!, null!, value);
    //         processSymbolDef(def, options);
    //         verify(builder.pushData(value)).once();
    //     });
    // });
})
