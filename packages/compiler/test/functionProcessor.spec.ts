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
    describe('for of loop', () => {
        it("should work", () => {
            const contract = /*javascript*/ `for (const v of [1,2,3,4]) { ; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForOfStatement);
            const childs = stmt.getChildren();
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

    describe("for loop", () => {
        it("var decl init", () => {
            const contract = /*javascript*/ `for (var i = 0; i < 10; i++) { ; }`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();
            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForStatement);
            const initLoc = stmt
                .getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.VariableDeclarationList)
                .getDeclarations()[0].getNameNode();
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // initializer
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                // start target
                { kind: 'noop' },
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                // continue target
                { kind: 'noop' },
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                // condition target
                { kind: 'noop' },
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                // break target
                { kind: 'noop' },
            );
        });

        
        it("null condition", () => {
            const contract = /*javascript*/ `for (var i = 0; ; i++) { ; }`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();
            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForStatement);
            const initLoc = stmt
                .getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.VariableDeclarationList)
                .getDeclarations()[0].getNameNode();
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                // start target
                { kind: 'noop' },
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                // continue target
                { kind: 'noop' },
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                // condition target
                { kind: 'noop' },
                // no condition
                // jump to start target
                { kind: 'jump', target: ops[3] },
                // break target
                { kind: 'noop' },
            );
        });

        it("null incrementor", () => {
            const contract = /*javascript*/ `for (var i = 0; i < 10;) { ; }`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();
            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForStatement);
            const initLoc = stmt
                .getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.VariableDeclarationList)
                .getDeclarations()[0].getNameNode();
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[8] },
                // start target
                { kind: 'noop' },
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                // continue target
                { kind: 'noop' },
                // no incrementor
                // condition target
                { kind: 'noop' },
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                // break target
                { kind: 'noop' },
            );
        });

        it("break", () => {
            const contract = /*javascript*/ `for (var i = 0; i < 10; i++) { break; }`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();
            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForStatement);

            const $break = stmt.getStatement().asKindOrThrow(tsm.SyntaxKind.Block)
                .getStatements()[0];

            const initLoc = stmt
                .getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.VariableDeclarationList)
                .getDeclarations()[0].getNameNode();
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                // start target
                { kind: 'noop' },
                // skip validating block 
                { skip: true },
                { kind: 'jump', target: ops[17], location: $break },
                { skip: true },
                // continue target
                { kind: 'noop' },
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                // condition target
                { kind: 'noop' },
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                // break target
                { kind: 'noop' },
            );
        });

        it("continue", () => {
            const contract = /*javascript*/ `for (var i = 0; i < 10; i++) { continue; }`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();
            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.ForStatement);

            const $break = stmt.getStatement().asKindOrThrow(tsm.SyntaxKind.Block)
                .getStatements()[0];

            const initLoc = stmt
                .getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.VariableDeclarationList)
                .getDeclarations()[0].getNameNode();
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                // start target
                { kind: 'noop' },
                // skip validating block 
                { skip: true },
                { kind: 'jump', target: ops[7], location: $break },
                { skip: true },
                // continue target
                { kind: 'noop' },
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                // condition target
                { kind: 'noop' },
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                // break target
                { kind: 'noop' },
            );
        });

        it("expr init", () => {
            const contract = /*javascript*/ `let i; for (i = 0; i < 10; i++) { ; }`
            const { sourceFile } = createTestProject(contract);
            const i = createVarDeclCTO(sourceFile, 'i');

            const scope = createTestScope(undefined, i);
            const stmt = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ForStatement);
            const initLoc = stmt
                .getInitializerOrThrow().asKindOrThrow(tsm.SyntaxKind.BinaryExpression)
                ;
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).empty;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializerOrThrow()),
                { kind: 'duplicate' },
                i.storeOp,
                { kind: 'drop' },
                // jump to condition target
                { kind: 'jump', target: ops[14] },
                // start target
                { kind: 'noop' },
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                // continue target
                { kind: 'noop' },
                // incrementor
                { ...i.loadOp, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                i.storeOp,
                // condition target
                { kind: 'noop' },
                // condition
                { ...i.loadOp, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[5] },
                // break target
                { kind: 'noop' },
            );
        });

        it("null init", () => {
            const contract = /*javascript*/ `let i; for (; i < 10; i++) { ; }`
            const { sourceFile } = createTestProject(contract);
            const i = createVarDeclCTO(sourceFile, 'i');

            const scope = createTestScope(undefined, i);
            const stmt = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ForStatement);
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.breakTargets).empty;
            expect(context.continueTargets).empty;
            expect(context.locals).empty;

            expectResults(ops,
                // no initializer
                // jump to condition target
                { kind: 'jump', target: ops[10] },
                // start target
                { kind: 'noop' },
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                // continue target
                { kind: 'noop' },
                // incrementor
                { ...i.loadOp, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                i.storeOp,
                // condition target
                { kind: 'noop' },
                // condition
                { ...i.loadOp, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[1] },
                // break target
                { kind: 'noop' },
            );
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