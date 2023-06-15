import 'mocha';
import { expect } from 'chai';
import * as tsm from 'ts-morph';

import { identity, pipe } from 'fp-ts/function';
import * as E from 'fp-ts/Either';
import { parseExpression, reduceExpressionHead } from '../src/passes/expressionProcessor';
import { CompileTimeType, Scope, createEmptyScope } from '../src/types/CompileTimeObject';
import { createPropResolver, createPropResolvers, createTestProject, createTestScope, createTestVariable, expectPushData, makeFunctionInvoker as createFunctionInvoker, testParseExpression, expectPushInt, expectResults, createTestGlobalScope, expectEither, createVarDeclCTO } from "./testUtils.spec";
import { Operation, pushInt, pushString } from '../src/types/Operation';
import { sc } from '@cityofzion/neon-core';
import { adaptStatement, AdaptStatementContext} from '../src/passes/functionProcessor';

describe('function processor', () => {
    describe('for of loop', () => {
        it("should work", () => {
            const contract = /*javascript*/ `for (const v of [1,2,3,4]) { ; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForOfStatement);
            const { ops, context } = testAdaptStatement(scope, stmt);



        });
    })
})

function testAdaptStatement(scope: Scope, node: tsm.Statement) {
    const returnTarget: Operation = { kind: 'noop'};

    const [ops, context] = adaptStatement(node)({
        scope,
        returnTarget,
        breakTargets: [],
        continueTargets: [],
        errors: [],
        locals: [],
    });
    if (context.errors.length > 0) {
        if (context.errors.length === 1) {
            expect.fail(context.errors[0].message);
        } else {
            const msg = context.errors.map(e => e.message).join('\n');
            expect.fail(msg);
        }
    }
    return { ops, context}

}