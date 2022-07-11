import { sc } from '@cityofzion/neon-core';
import { expect } from 'chai';
import 'mocha';
import { SyntaxKind } from 'ts-morph';
import { ContractTypeKind, PrimitiveContractType, PrimitiveType } from '../src/contractType';
import { convertTypeScriptType } from '../src/convert';
import { testCompileNode } from './testCompileNode';

describe('convertTypeScriptType', () => {
    it('string to PrimitiveContractType.String', () => {
        const decl = testCompileNode("const value: string = ''", SyntaxKind.VariableDeclaration);
        const type = convertTypeScriptType(decl.getType());
        expect(type.kind).to.eq(ContractTypeKind.Primitive)
        expect((type as PrimitiveContractType).type).eq(PrimitiveType.String)
    });
});