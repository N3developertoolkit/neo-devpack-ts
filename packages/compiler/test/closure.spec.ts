import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";
import * as E from 'fp-ts/Either';
import { createTestProject, expectEither, expectResults, createLiteralCTO, createVarDeclCTO, createTestScope } from './testUtils.spec';
import { hoistFunctionDecl, hoistInterfaceDecl } from '../src/passes/hoistDeclarations';
import { pipe } from 'fp-ts/lib/function';
import { GetOpsFunc } from '../src/types/CompileTimeObject';
import { CompileTimeObject } from '../src/types/CompileTimeObject';
import { ParseError, makeParseError } from '../src/utils';
import { pushInt, pushString } from '../src/types/Operation';
import { getLocalVariables } from '../src/passes/functionProcessor';


describe("closure", () => {
    it("should work", () => {
        const contract = /*javascript*/` 
            function test(pNoClose: number, pClose: number, [pClose2, pNoClose2]: [number, number]) { 
                const vClose = 12; 
                const vNoClose = 2;
                const [aN1,aC2,aN3] = [1,2,3];
                function foo() { 
                    return () => vClose + pClose + aC2 + pClose2; 
                } 

                for (const forN of [1,2,3]) {

                }


            }`;
        const { sourceFile } = createTestProject(contract);
        const test = sourceFile.getFunctionOrThrow("test");

        getLocalVariables(test);

    })
})