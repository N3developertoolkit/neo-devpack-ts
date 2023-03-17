import 'mocha';
import { assert, expect } from 'chai';

import * as tsm from "ts-morph";

import { identity, pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray';

import { createTestProject } from '../utils.spec';
import { makeFunctionDeclScope } from '../passes/functionDeclarationProcessor'
import { Operation } from '../types/Operation';
import { parseExpression } from './expressionProcessor';
import { createScope, updateScope as $updateScope } from '../scope';
import { ParseError, Scope, SymbolDef } from '../types/ScopeType';
import { makeParseError } from '../symbolDef';

function testRight<A>(value: E.Either<ParseError, A>) {
    if (E.isRight(value))
        return value.right;
    assert.fail(value.left.message);
}


describe("expressionProcessor", () => {
    it("ConditionalExpression", () => {

        const contract = /*javascript*/`
        export function test(value: boolean) {
            return value ? 1n : 0n;
        }`;

        const { sourceFile, scope: parentScope } = createTestProject(contract);
        const func = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
        const value = func.getParameterOrThrow("value");
        const expr = func.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.ReturnStatement).getExpression()!;
        const scope = createScope(parentScope)([{
            symbol: value.getSymbolOrThrow(),
            type: value.getType(),
            loadOps: [{
                kind: "loadlocal",
                index: 0,
                debug: "value"
            } as Operation]
        }]);

        const ops = pipe(expr, parseExpression(scope), testRight)

        


                
    })
})