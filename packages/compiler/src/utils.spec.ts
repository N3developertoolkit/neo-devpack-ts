import { expect } from 'chai';
import 'mocha';
import { Context, Runnable } from 'mocha';
import * as tsm from "ts-morph";
import { createTestProject } from './scope.spec';
import { bigIntToByteArray, byteArrayToBigInt, getConstantValue } from './utils';
import { negativeValueTests, positiveValueTests } from './utils.bigIntToByteArray.spec';

describe("utils", () => {
    describe("toHexString", () => {
        function test({ value, expected }: { value: bigint, expected: string}) {
            it(`${value}`, () => {
            });
        }

        positiveValueTests.forEach(test);
        negativeValueTests.forEach(test);

    })
    describe('bigIntToByteArray', () => {

        function testConvertInt({ value, expected }: { value: bigint, expected: string}) {
            it(`${value}`, () => {

                const bufferExpected = Buffer.from(expected, 'hex');
                expect(bigIntToByteArray(value)).to.deep.equal(bufferExpected);
            });
        }

        positiveValueTests.forEach(testConvertInt);
        negativeValueTests.forEach(testConvertInt);
    });

    describe('byteArrayToBigInt', () => {

        function testConvertBuffer({ value, expected }: { value: bigint, expected: string}) {

            // skip negative values for now
            it(`0x${expected} -> ${value}`, function () {
                if (value < 0n) { 
                    this.skip(); 
                } else {
                    const buffer = Buffer.from(expected, 'hex');
                    expect(byteArrayToBigInt(buffer)).to.equal(value);
                } 
            });
        }

        positiveValueTests.forEach(testConvertBuffer);
        negativeValueTests.forEach(testConvertBuffer);
    });

    describe("getConstantValue", () => {
        async function runTest(expected: string) {
            const { sourceFile } = await createTestProject(`const value = ${expected};`)
            const stmt = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
            const decls = stmt.getDeclarations();
            return getConstantValue(decls[0].getInitializerOrThrow());
        }

        it("numeric literal", async () => {
            const expected = BigInt(123);
            const value = await runTest(`123`);
            expect(value).eq(expected);
        });
        it("bigint literal", async () => {
            const expected = BigInt(123);
            const value = await runTest(`123n`);
            expect(value).eq(expected);
        });
        it("true literal", async () => {
            const expected = true;
            const value = await runTest(`true`);
            expect(value).eq(expected);
        });
        it("false literal", async () => {
            const expected = false;
            const value = await runTest(`false`);
            expect(value).eq(expected);
        });
        it("null literal", async () => {
            const value = await runTest("null");
            expect(value).null;
        });
        it("string literal", async () => {
            const expected = "Hello, World!";
            const value = await runTest(`"${expected}"`);
            expect(value).eql(Buffer.from(expected, 'utf8'));
        });
    });
});