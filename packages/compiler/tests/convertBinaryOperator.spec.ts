import { sc } from '@cityofzion/neon-core';
import { expect } from 'chai';
import 'mocha';
import { SyntaxKind } from 'ts-morph';
import { convertBinaryOperator } from '../src/convert';
import { testCompileNode } from './testCompileNode';


describe('convertBinaryOperator', () => {
    describe('string plus', () => {

        const exp = testCompileNode("'foo' + 'bar'", SyntaxKind.BinaryExpression);

        it('returns single CAT instruction', () => { 
            const instructions = convertBinaryOperator(exp);
            expect(instructions.length).to.equal(1); 
            expect(instructions[0].opCode).to.equal(sc.OpCode.CAT);
        });
    });
});