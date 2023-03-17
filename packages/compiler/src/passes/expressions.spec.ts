import 'mocha';
import { assert, expect } from 'chai';

import * as tsm from "ts-morph";

import { flow, identity, pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray';

import { createTestProject, createTestScope, testRight } from '../utils.spec';
import { makeFunctionDeclScope } from '../passes/functionDeclarationProcessor'
import { convertJumpTargetOps, Operation } from '../types/Operation';
import { parseExpression } from './expressionProcessor';
import { createScope, updateScope as $updateScope } from '../scope';
import { ParseError, Scope, SymbolDef } from '../types/ScopeType';
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