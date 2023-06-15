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
import { adaptStatement, AdaptStatementContext } from '../src/passes/functionProcessor';

describe('function processor', () => {
    describe.skip('for of loop', () => {
        it("should work", () => {
            const contract = /*javascript*/ `for (const v of [1,2,3,4]) { ; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForOfStatement);
            const { ops, context } = testAdaptStatement(scope, stmt);



        });
    })

    describe("return", () => {
        it("return value", () => {
            const contract = /*javascript*/ `function foo(){ return 42; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const func = sourceFile
                .forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const stmt = func
                .getBodyOrThrow().asKindOrThrow(tsm.SyntaxKind.Block)            
                .getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ReturnStatement);
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).empty;
            expectResults(ops,
                pushInt(42, stmt),
                { kind: 'jump', target: context.returnTarget }
            )
        });

        it("return no value", () => {
            const contract = /*javascript*/ `function foo(){ return; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const func = sourceFile
                .forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const stmt = func
                .getBodyOrThrow().asKindOrThrow(tsm.SyntaxKind.Block)            
                .getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ReturnStatement);
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).empty;
            expectResults(ops,
                { kind: 'jump', target: context.returnTarget, location: stmt }
            )
        });
    })

    describe("block", () => {
        it("empty", () => {
            const contract = /*javascript*/ ` { ; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.Block);
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).empty;
            expectResults(ops,
                { kind: 'noop', location: stmt.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken) },
                { kind: 'noop', location: stmt.getStatements()[0] },
                { kind: 'noop', location: stmt.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken) },
            )
        });

        it("var decl in block", () => {
            const contract = /*javascript*/ ` { var q = 42; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.Block);
            const decl = stmt.getStatements()[0]
                .asKindOrThrow(tsm.SyntaxKind.VariableStatement)
                .getDeclarations()[0];
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "q");
            expect(context.locals[0]).property("type", decl.getType());

            expectResults(ops,
                { kind: 'noop', location: stmt.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken) },
                pushInt(42),
                { kind: 'storelocal', index: 0, location: decl.getNameNode() },
                { kind: 'noop', location: stmt.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken) },
            )
        });

        it("const decl in block", () => {
            const contract = /*javascript*/ ` { const q = 42; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.Block);
            const decl = stmt.getStatements()[0]
                .asKindOrThrow(tsm.SyntaxKind.VariableStatement)
                .getDeclarations()[0];
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).empty;

            expectResults(ops,
                { kind: 'noop', location: stmt.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken) },
                { kind: 'noop', location: stmt.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken) },
            )
        });
    });
})

function testAdaptStatement(scope: Scope, node: tsm.Statement) {
    const returnTarget: Operation = { kind: 'noop' };

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
    return { ops, context }

}