import { expect } from 'chai';
import 'mocha';

import * as tsm from 'ts-morph'
import { parseExpression } from './expressionProcessor';
import { pipe } from 'fp-ts/lib/function';

import { bufferEquals, createTestProject, createTestScope, testRight } from '../utils.spec';
import { ParseError, Scope, SymbolDef } from '../types/ScopeType';
import { Operation } from '../types/Operation';
import { createScope } from '../scope';


describe("builtins", () => {
    it("concat", () => {
        const contract = /*javascript*/`
            const result = concat(ByteString.fromHex('0x00'), ByteString.fromHex('0xFF'))
        `;

        const { sourceFile, globalScope } = createTestProject(contract);

        const init = sourceFile
            .getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement)
            .getDeclarations()[0]
            .getInitializerOrThrow();

        const ops = pipe(init, parseExpression(globalScope), testRight(e => e.message));

        expect(ops).has.lengthOf(3);
        expect(ops[0]).has.property('kind').that.equals('pushdata');
        expect(ops[0]).has.property('value').and.satisfies(bufferEquals('00'))
        expect(ops[1]).has.property('kind').that.equals('pushdata');
        expect(ops[1]).has.property('value').and.satisfies(bufferEquals('FF'))
        expect(ops[2]).has.property('kind').that.equals('concat');
    });

    describe("ByteString", () => {

        it("fromHex", () => {
            const contract = /*javascript*/`
            const result = ByteString.fromHex('0x00');
        `;
            const { sourceFile, globalScope } = createTestProject(contract);
            const decls = sourceFile.getVariableStatements();
            const resultExpr = decls[0].getDeclarations()[0].getInitializerOrThrow();
            const ops = pipe(resultExpr, parseExpression(globalScope), testRight(e => e.message));

            expect(ops).lengthOf(1);
            expect(ops[0]).has.property('kind').that.equals('pushdata');
            expect(ops[0]).has.property('value').and.satisfies(bufferEquals('00'))
        });

        it("length", () => {
            const contract = /*javascript*/`
            const value = ByteString.fromHex('0x00');
            const result = value.length;
        `;

            const { sourceFile, globalScope } = createTestProject(contract);
            const decls = sourceFile.getVariableStatements();
            const value = decls[0].getDeclarations()[0];
            const resultExpr = decls[1].getDeclarations()[0].getInitializerOrThrow();
            const scope = createTestScope(globalScope)(value);

            const ops = pipe(resultExpr, parseExpression(scope), testRight(e => e.message));

            expect(ops).length(2);
            expect(ops[0]).has.property('kind').that.equals('loadlocal');
            expect(ops[1]).has.property('kind').that.equals('size');
        });

        it("asInteger", () => {
            const contract = /*javascript*/`
            const value = ByteString.fromHex('0x00');
            const result = value.asInteger();
        `;

            const { sourceFile, globalScope } = createTestProject(contract);
            const decls = sourceFile.getVariableStatements();
            const value = decls[0].getDeclarations()[0];
            const resultExpr = decls[1].getDeclarations()[0].getInitializerOrThrow();
            const scope = createTestScope(globalScope)(value);

            const ops = pipe(resultExpr, parseExpression(scope), testRight(e => e.message));
            expect(ops[0]).has.property('kind').that.equals('loadlocal');


        })

    })

});

// /** @safe */
// export function balanceOf(account: ByteString): bigint {
//     if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
//     const key = concat(BALANCE_PREFIX, account);
//     const value = Storage.context.get(key);
//     return value ? value.asInteger() : 0n;
// }
