import { instance, mock, when } from 'ts-mockito';
import 'mocha';
import * as tsm from "ts-morph";
import { ReadonlyScope, SymbolDef } from '../scope';
import { createTestProject } from '../scope.spec'
import { ParseResult, parseStringLiteral } from './expressionProcessor';
import { expect } from 'chai';
import { Operation } from '../types/Operation';

export function testScope(def: SymbolDef): ReadonlyScope {
    const scope = mock<ReadonlyScope>();
    when(scope.resolve(def.symbol)).thenReturn(def);
    return instance(scope);
}

function testResult(result: ParseResult): Operation[] {
    expect(result.isOk()).true;
    return result.unwrap();
}

describe("expression parser", () => {
    it ("parseStringLiteral", () => {

        const js = /*javascript*/`function test() { return "Hello World";}`;
        const {sourceFile} = createTestProject(js)
        const node = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.StringLiteral);
        const result = testResult(parseStringLiteral(node));
        
        


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