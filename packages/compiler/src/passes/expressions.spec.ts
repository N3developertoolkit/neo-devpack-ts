import 'mocha';
import { assert, expect } from 'chai';

import * as tsm from "ts-morph";

import { identity, pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray';

import { createTestProject, createTestScope, testRight } from '../utils.spec';
import { makeFunctionDeclScope } from '../passes/functionDeclarationProcessor'
import { Operation } from '../types/Operation';
import { parseExpression } from './expressionProcessor';
import { createScope, updateScope as $updateScope } from '../scope';
import { ParseError, Scope, SymbolDef } from '../types/ScopeType';
import { makeParseError } from '../symbolDef';



describe("expressionProcessor", () => {
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