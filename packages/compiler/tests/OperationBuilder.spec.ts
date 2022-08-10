import { expect } from 'chai';
import 'mocha';
import { OpCode } from '../src/types/OpCode';
import { OperationBuilder } from '../src/types/OperationBuilder';

describe('OperationBuilder', () => {
    it('test', () => {
        const builder = new OperationBuilder();
        builder.pushInt(10);
        builder.pushInt(11);
        builder.pushInt(12);
        builder.pushInt(13);
        builder.pushInt(14);
        builder.pushInt(5);
        builder.push(OpCode.PACK);
        const bytes = builder.pullByteString();

    });
});