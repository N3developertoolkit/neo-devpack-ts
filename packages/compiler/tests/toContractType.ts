// import { sc } from '@cityofzion/neon-core';
// import { expect } from 'chai';
// import 'mocha';
// import { SyntaxKind } from 'ts-morph';
// import { ContractTypeKind, PrimitiveContractType, PrimitiveType } from '../src/contractType';
// import { toContractType } from '../src/contractType';
// import { testCompileNode } from './testCompileNode';

// describe('toContractType', () => {
//     it('string to PrimitiveContractType.String', () => {
//         const decl = testCompileNode("const value: string = ''", SyntaxKind.VariableDeclaration);
//         const type = toContractType(decl.getType());
//         expect(type.kind).to.eq(ContractTypeKind.Primitive)
//         expect((type as PrimitiveContractType).type).eq(PrimitiveType.String)
//     });
//     it('bigint to PrimitiveContractType.Integer', () => {
//         const decl = testCompileNode("const value = 0n", SyntaxKind.VariableDeclaration);
//         const type = toContractType(decl.getType());
//         expect(type.kind).to.eq(ContractTypeKind.Primitive)
//         expect((type as PrimitiveContractType).type).eq(PrimitiveType.Integer)
//     });
//     it('bool to PrimitiveContractType.Integer', () => {
//         const decl = testCompileNode("const value = true", SyntaxKind.VariableDeclaration);
//         const type = toContractType(decl.getType());
//         expect(type.kind).to.eq(ContractTypeKind.Primitive)
//         expect((type as PrimitiveContractType).type).eq(PrimitiveType.Boolean)
//     });
// });