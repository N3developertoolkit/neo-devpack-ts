import { sc } from '@cityofzion/neon-core';
import { expect } from 'chai';
import 'mocha';
import { ScriptBuilder } from '../src/ScriptBuilder';
import { testCompile } from './testCompileNode';

describe ('scriptBuilder', () => {
    it("overloads", () => {
        const array = [1,2,3,4,5];
        const uintArray = Uint8Array.from([10,10,10,10]);
        const { sourceFile } = testCompile("'foo' + 'bar'");
        const builder = new ScriptBuilder();
        builder.push(sc.OpCode.RET);
        builder.push(sc.OpCode.PUSHDATA1, array);
        builder.push(sc.OpCode.PUSHDATA1, uintArray);
        builder.push({
            opCode: sc.OpCode.PUSHDATA1,
            operand: uintArray
        });
        builder.push(sc.OpCode.RET, sourceFile);
        builder.push(sc.OpCode.PUSHDATA1, array, sourceFile);
        builder.push(sc.OpCode.PUSHDATA1, uintArray, sourceFile);
        builder.push({
            opCode: sc.OpCode.PUSHDATA1,
            operand: uintArray
        }, sourceFile);


    })
});