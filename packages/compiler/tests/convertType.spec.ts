import { sc } from '@cityofzion/neon-core';
import { expect } from 'chai';
import 'mocha';
import { SyntaxKind } from 'ts-morph';
import { ContractTypeKind, PrimitiveContractType, PrimitiveType } from '../src/contractType';
import { convertType } from '../src/convert';
import { fakeCompileNode } from './fakeCompileNode';

describe('convertType', () => {
    it('string to PrimitiveContractType.String', () => {
        const decl = fakeCompileNode("const value: string = ''", SyntaxKind.VariableDeclaration);
        const type = convertType(decl.getType());
        expect(type.kind).to.eq(ContractTypeKind.Primitive)
        expect((type as PrimitiveContractType).type).eq(PrimitiveType.String)
    });
});