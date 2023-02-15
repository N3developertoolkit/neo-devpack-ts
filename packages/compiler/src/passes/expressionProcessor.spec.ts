import { instance, mock, when } from 'ts-mockito';
import 'mocha';
import * as tsm from "ts-morph";
import { ReadonlyScope, SymbolDef } from '../scope';
import { createTestProject } from '../scope.spec'
import { parseArrayLiteral, parseBinaryExpression, ParseResult, parseStringLiteral } from './expressionProcessor';
import { expect } from 'chai';
import { Operation } from '../types/Operation';

export function testScope(def: SymbolDef): ReadonlyScope {
    const scope = mock<ReadonlyScope>();
    when(scope.resolve(def.symbol)).thenReturn(def);
    return instance(scope);
}

function expectOk(result: ParseResult): Operation[] {
    expect(result.isOk()).true;
    return result.unwrap();
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
// class FakeScope implements Scope {

//     readonly parentScope = undefined;

//     define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T {
//         return typeof factory === 'function' ? factory(this) : factory;
//     }

//     get symbols(): IterableIterator<SymbolDef> {
//         throw new Error('Method not implemented.');
//     }
//     resolve(symbol: tsm.Symbol): SymbolDef | undefined {
//         throw new Error('Method not implemented.');
//     }
// }

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
        const js = /*javascript*/`function test() { return 2 + 2; }`;
        const { sourceFile } = createTestProject(js)
        const node = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.BinaryExpression);
        const scope = new TestScope();
        const result = expectOk(parseBinaryExpression(node, scope));
    });

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