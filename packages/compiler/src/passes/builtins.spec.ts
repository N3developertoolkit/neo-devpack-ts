import { expect } from 'chai';
import 'mocha';

import * as tsm from 'ts-morph'
import { parseExpression } from './expressionProcessor';
import { pipe } from 'fp-ts/lib/function';

import { bufferEquals, createTestProject, testRight } from '../utils.spec';

describe("builtins", () => {
    it("concat", () => {
        const contract = /*javascript*/`
            const result = concat(ByteString.fromHex('0x00'), ByteString.fromHex('0xFF'))
        `;

        const { sourceFile, scope } = createTestProject(contract);

        const init = sourceFile
            .getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement)
            .getDeclarations()[0]
            .getInitializerOrThrow();

        const ops = pipe(init, parseExpression(scope), testRight);

        expect(ops).has.lengthOf(3);
        expect(ops[0]).has.property('kind').that.equals('pushdata');
        expect(ops[0]).has.property('value').and.satisfies(bufferEquals('00'))
        expect(ops[1]).has.property('kind').that.equals('pushdata');
        expect(ops[1]).has.property('value').and.satisfies(bufferEquals('FF'))
        expect(ops[2]).has.property('kind').that.equals('concat');
    });

});

// /** @safe */
// export function balanceOf(account: ByteString): bigint {
//     if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
//     const key = concat(BALANCE_PREFIX, account);
//     const value = Storage.context.get(key);
//     return value ? value.asInteger() : 0n;
// }
