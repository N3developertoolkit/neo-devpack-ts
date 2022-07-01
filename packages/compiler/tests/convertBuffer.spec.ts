import { sc } from '@cityofzion/neon-core';
import { expect } from 'chai';
import 'mocha';
import { convertBuffer } from '../src/convert';

describe('convertBuffer', () => {
  describe('short buffer', () => {
    const buffer = Buffer.from('Hello, world!', 'utf-8');
    it('returns single pushdata1 instruction', () => { 
      const instructions = convertBuffer(buffer);
      expect(instructions.length).to.equal(1); 
      const instruction = instructions[0];
      expect(instruction.opCode).to.equal(sc.OpCode.PUSHDATA1);
      expect(instruction.operand).is.not.undefined;
      const operand = instruction.operand!;
      expect(operand[0]).to.eq(buffer.length);
      expect(operand.slice(1)).to.eql(buffer);
    });
  });
});