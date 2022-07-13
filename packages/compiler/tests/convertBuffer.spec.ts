import { sc } from '@cityofzion/neon-core';
import { expect } from 'chai';
import 'mocha';
import { convertBuffer } from '../src/convert';
import { randomBytes } from 'node:crypto';

function getSizePrefix(opCode:sc.OpCode) {
  switch (opCode) {
    case sc.OpCode.PUSHDATA1: return 1;
    case sc.OpCode.PUSHDATA2: return 2;
    case sc.OpCode.PUSHDATA4: return 4;
    default: return 0;
  }
}

function readSize(opCode:sc.OpCode, operand: Uint8Array) {
  switch (opCode) {
    case sc.OpCode.PUSHDATA1: return operand[0];
    case sc.OpCode.PUSHDATA2: return Buffer.from(operand.slice(0, 2)).readUInt16LE();
    case sc.OpCode.PUSHDATA4: return Buffer.from(operand.slice(0, 4)).readUInt32LE();
    default: return 0;
  }
}
describe ('convertBuffer', () => {

  const tests = [
      { length: 255, opCode: sc.OpCode.PUSHDATA1 },
      { length: 256, opCode: sc.OpCode.PUSHDATA2 },
      { length: 65535, opCode: sc.OpCode.PUSHDATA2 },
      { length: 65536, opCode: sc.OpCode.PUSHDATA4 },
  ]

  tests.forEach(({ length, opCode }) => {
      it(`convertBuffer length ${length}`, () => {
          const sizePrefix = getSizePrefix(opCode);
          const data = randomBytes(length);
          var actual = convertBuffer(data);
          expect(actual.opCode).to.equal(opCode);
          expect(actual.operand).not.to.be.undefined;
          expect(actual.operand?.length).to.equal(data.length + sizePrefix);
          expect(Buffer.compare(data, actual.operand!.slice(sizePrefix))).to.equal(0);
          expect(readSize(opCode, actual.operand!)).to.equal(length);
      });
    });
});
