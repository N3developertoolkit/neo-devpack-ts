import 'mocha';

import * as tsm from "ts-morph";

import { flow, pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";

import { createTestProject, createTestScope, testRight } from '../utils.spec';
import { convertJumpTargetOps } from '../types/Operation';
import { parseExpression } from './expressionProcessor';
import { makeParseError } from '../symbolDef';



describe("expressionProcessor", () => {
    it ("Optional Chaining", () => {
        const contract = /*javascript*/`
        const value = ByteString.fromHex('0x00');
        const result = value?.asInteger() ?? 0n;
    `;

        const { sourceFile, globalScope } = createTestProject(contract);
        const decls = sourceFile.getVariableStatements();
        const value = decls[0].getDeclarations()[0];
        const resultExpr = decls[1].getDeclarations()[0].getInitializerOrThrow();
        const scope = createTestScope(globalScope)(value);

        const ops = pipe(
            resultExpr, 
            parseExpression(scope), 
            E.chain(flow(convertJumpTargetOps, E.mapLeft(makeParseError()))),
            testRight(e => e.message)
            );


    })
    it("ConditionalExpression", () => {

        const contract = /*javascript*/`
        export function test(value: boolean) {
            return value ? 1n : 0n;
        }`;

        const { sourceFile, globalScope } = createTestProject(contract);
        const func = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
        const value = func.getParameterOrThrow("value");
        const expr = func.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.ReturnStatement).getExpression()!;
        const scope = createTestScope(globalScope)(value);
        const ops = pipe(expr, parseExpression(scope), testRight(e => e.message));

        


                
    })
})