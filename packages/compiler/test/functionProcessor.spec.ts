import 'mocha';
import { expect } from 'chai';
import * as tsm from 'ts-morph';

import * as E from 'fp-ts/lib/Either';
import { createTestProject, createTestScope, expectResults, createVarDeclCTO, findDebug, makeTarget, testAdaptStatement } from "./testUtils.spec";
import { pushInt } from '../src/types/Operation';
import { parseContractMethod } from '../src/passes/functionProcessor';
import { pipe } from 'fp-ts/lib/function';

describe('function processor', () => {
    describe("not supported", () => {
        it('async function ', () => {
            const contract = `async function foo() {}`;
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope(undefined);

            const decl = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const result = pipe(decl, parseContractMethod(scope));

            expect(E.isLeft(result)).to.be.true;
        })

        it('async generator function ', () => {
            const contract = `async function *foo() {}`;
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope(undefined);

            const decl = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const result = pipe(decl, parseContractMethod(scope));

            expect(E.isLeft(result)).to.be.true;
        })

        it('generator function ', () => {
            const contract = `function *foo() {}`;
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope(undefined);

            const decl = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const result = pipe(decl, parseContractMethod(scope));

            expect(E.isLeft(result)).to.be.true;
        })
    })

    describe("switch", () => {
        it("should work", () => {
            const contract = /*javascript*/ `
                let n: number = null!;
                function foo(){
                    switch (n) {
                        case 1: 
                            break;
                        case 2: 
                            break;
                        default: 
                            break;
                    }
                }`
            const { sourceFile } = createTestProject(contract);
            const n = createVarDeclCTO(sourceFile, 'n');
            const scope = createTestScope(undefined, n);

            const func = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const $switch = func.getBodyOrThrow().asKindOrThrow(tsm.SyntaxKind.Block)
                .forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.SwitchStatement);

            const clauses = $switch.getClauses() 
            const expr1 = (clauses[0] as tsm.CaseClause).getExpression();
            const expr2 = (clauses[1] as tsm.CaseClause).getExpression();
            const $default = ($switch.getClauses()[2] as tsm.DefaultClause);
            const childs = $default.getChildren();
            const { ops, context } = testAdaptStatement(scope, $switch);

            expectResults(ops,
                { ... n.loadOp, location: $switch.getExpression() },
                { kind: 'storelocal', index: 0 },
                pushInt(1, expr1),
                { kind: 'loadlocal', index: 0 },
                { kind: 'equal'},
                { kind: 'jumpif', target: ops[12] },
                pushInt(2, expr2),
                { kind: 'loadlocal', index: 0 },
                { kind: 'equal'},
                { kind: 'jumpif', target: ops[14] },
                { kind: 'jump', target: ops[16], location: $default.getChildren()[0]  },
                { kind: 'jump', target: ops[18] },
                { kind: 'noop', debug: 'clauseTarget' },
                { kind: 'jump', target: ops[18], location: clauses[0].getStatements()[0] },
                { kind: 'noop', debug: 'clauseTarget' },
                { kind: 'jump', target: ops[18], location: clauses[1].getStatements()[0] },
                { kind: 'noop', debug: 'clauseTarget' },
                { kind: 'jump', target: ops[18], location: clauses[2].getStatements()[0] },
                { kind: 'noop', debug: 'breakTarget' },
            )
        })
    })

    describe("try/catch", () => {
        it("return inside try finally", () => {
            const contract = /*javascript*/ `function foo(){ try { return; } finally { } };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();
            const func = sourceFile
                .forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const trystmt = func
                .getBodyOrThrow().asKindOrThrow(tsm.SyntaxKind.Block)
                .getStatements()[0].asKindOrThrow(tsm.SyntaxKind.TryStatement);
            const retStmt = trystmt.getTryBlock().getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ReturnStatement);
            const { ops, context } = testAdaptStatement(scope, trystmt);

            expectResults(ops,
                { kind: 'try', catchTarget: undefined, finallyTarget: ops[5] },
                { $kind: 'noop' }, // try block start
                { kind: 'endtry', target: context.returnTarget, location: retStmt },
                { $kind: 'noop' }, // try block end
                { kind: 'endtry', target: ops[9] },
                { kind: 'noop', debug: 'finallyTarget' },
                { $kind: 'noop' }, // finally block start
                { $kind: 'noop' }, // finally block end
                { kind: 'endfinally' },
                { kind: 'noop', debug: 'endTarget' },
            );
        });

        it("return inside nested try finally", () => {
            const contract = /*javascript*/ `function foo(){ 
                try {
                    try { return; } 
                    finally { } 
                } finally { } };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();
            const func = sourceFile
                .forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
            const trystmt = func
                .getBodyOrThrow().asKindOrThrow(tsm.SyntaxKind.Block)
                .getStatements()[0].asKindOrThrow(tsm.SyntaxKind.TryStatement);
            const innerTry = trystmt.getTryBlock().getStatements()[0].asKindOrThrow(tsm.SyntaxKind.TryStatement);
            const retstmt = innerTry.getTryBlock().getStatements()[0].asKindOrThrow(tsm.SyntaxKind.ReturnStatement);

            const { ops, context } = testAdaptStatement(scope, trystmt);

            expectResults(ops,
                { kind: 'try', catchTarget: undefined, finallyTarget: ops[15] },
                { $kind: 'noop' }, // outer try block start
                { kind: 'try', catchTarget: undefined, finallyTarget: ops[15] },
                { $kind: 'noop' }, // inner try block start
                { kind: 'endtry', offset: 1, location: retstmt },
                { kind: 'endtry', target: context.returnTarget },
                { $kind: 'noop' }, // inner try block end
                { kind: 'endtry', target: ops[12] },
                { kind: 'noop', debug: 'finallyTarget' },
                { $kind: 'noop' }, // inner finally block start
                { $kind: 'noop' }, // inner finally block end
                { kind: 'endfinally' },
                { kind: 'noop', debug: 'endTarget' },
                { $kind: 'noop' }, // outer try block end
                { kind: 'endtry', target: ops[19] },
                { kind: 'noop', debug: 'finallyTarget' },
                { $kind: 'noop' }, // outer finally block start
                { $kind: 'noop' }, // outer finally block end
                { kind: 'endfinally' },
                { kind: 'noop', debug: 'endTarget' },
            )
        });
    });



    describe('for of loop', () => {
        it("var decl init, iterator expr", () => {
            const contract = `class Items implements IterableIterator<number> {
                [Symbol.iterator](): IterableIterator<number> {
                    throw new Error('Method not implemented.');
                }
                next(...args: [] | [undefined]): IteratorResult<number, any> {
                    throw new Error('Method not implemented.');
                }
            }
            const items: Items = null!;
            for (const v of items) { ; }`;
            const { sourceFile } = createTestProject(contract);
            const items = createVarDeclCTO(sourceFile, 'items');
            const scope = createTestScope(undefined, items);

            const stmt = sourceFile.forEachChildAsArray()[2].asKindOrThrow(tsm.SyntaxKind.ForOfStatement);
            const { ops, context } = testAdaptStatement(scope, stmt);

            // TODO: validate results
        });

        it("var decl init, array expr", () => {
            const contract = /*javascript*/ `const items = [1,2,3,4]; for (const v of items) { ; };`
            const { sourceFile } = createTestProject(contract);
            const items = createVarDeclCTO(sourceFile, 'items');

            const scope = createTestScope(undefined, items);

            const stmt = sourceFile.forEachChildAsArray()[1].asKindOrThrow(tsm.SyntaxKind.ForOfStatement);
            const decl = stmt
                .getInitializer().asKindOrThrow(tsm.SyntaxKind.VariableDeclarationList)
                .getDeclarations()[0];


            const { ops, context } = testAdaptStatement(scope, stmt);

            expectResults(ops,
                { ...items.loadOp, location: stmt.getExpression() },
                { kind: 'duplicate' },
                { kind: "storelocal", index: 0 },
                { kind: "size" },
                { kind: "storelocal", index: 1 },
                pushInt(0),
                { kind: "storelocal", index: 2 },
                { kind: "jump", target: findDebug(ops, "conditionTarget") },
                { kind: "noop", debug: "startTarget" },
                { kind: "loadlocal", index: 0 },
                { kind: "loadlocal", index: 2 },
                { kind: "pickitem" },
                { kind: "storelocal", index: 3, location: decl },
                // skip block validation
                { skip: true },
                { skip: true },
                { skip: true },
                { kind: "noop", debug: "continueTarget", location: stmt.getInitializer() },
                { kind: "loadlocal", index: 2 },
                { kind: "increment" },
                { kind: "storelocal", index: 2 },
                { kind: "noop", debug: "conditionTarget" },
                { kind: "loadlocal", index: 2 },
                { kind: "loadlocal", index: 1 },
                { kind: "jumplt", target: findDebug(ops, "startTarget") },
                { kind: "noop", debug: "breakTarget" },
            )
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
            expect(context.environStack).empty;
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
            expect(context.environStack).empty;
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
            expect(context.environStack).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // initializer
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                makeTarget("startTarget"),
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                makeTarget("continueTarget"),
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                makeTarget("conditionTarget"),
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                makeTarget("breakTarget"),
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
            expect(context.environStack).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                makeTarget("startTarget"),
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                makeTarget("continueTarget"),
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                makeTarget("conditionTarget"),
                // no condition
                // jump to start target
                { kind: 'jump', target: ops[3] },
                makeTarget("breakTarget"),
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
            expect(context.environStack).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[8] },
                makeTarget("startTarget"),
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                makeTarget("continueTarget"),
                // no incrementor
                makeTarget("conditionTarget"),
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                makeTarget("breakTarget"),
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
            expect(context.environStack).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                makeTarget("startTarget"),
                // skip validating block 
                { skip: true },
                { kind: 'jump', target: ops[17], location: $break },
                { skip: true },
                makeTarget("continueTarget"),
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                makeTarget("conditionTarget"),
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                makeTarget("breakTarget"),
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
            expect(context.environStack).empty;
            expect(context.locals).length(1);
            expect(context.locals[0]).property("name", "i");
            expect(context.locals[0].type?.isNumber()).true;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializer()),
                { kind: 'storelocal', index: 0, location: initLoc },
                // jump to condition
                { kind: 'jump', target: ops[12] },
                makeTarget("startTarget"),
                // skip validating block 
                { skip: true },
                { kind: 'jump', target: ops[7], location: $break },
                { skip: true },
                makeTarget("continueTarget"),
                // incrementor
                { kind: 'loadlocal', index: 0, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                { kind: 'storelocal', index: 0 },
                makeTarget("conditionTarget"),
                // condition
                { kind: 'loadlocal', index: 0, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[3] },
                makeTarget("breakTarget"),
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
            expect(context.environStack).empty;
            expect(context.locals).empty;

            expectResults(ops,
                // init variable
                pushInt(0, stmt.getInitializerOrThrow()),
                { kind: 'duplicate' },
                i.storeOp,
                { kind: 'drop' },
                // jump to condition target
                { kind: 'jump', target: ops[14] },
                makeTarget("startTarget"),
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                makeTarget("continueTarget"),
                // incrementor
                { ...i.loadOp, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                i.storeOp,
                makeTarget("conditionTarget"),
                // condition
                { ...i.loadOp, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[5] },
                makeTarget("breakTarget"),
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
            expect(context.environStack).empty;
            expect(context.locals).empty;

            expectResults(ops,
                // no initializer
                // jump to condition target
                { kind: 'jump', target: ops[10] },
                makeTarget("startTarget"),
                // skip validating block 
                { skip: true },
                { skip: true },
                { skip: true },
                makeTarget("continueTarget"),
                // incrementor
                { ...i.loadOp, location: stmt.getIncrementorOrThrow() },
                { kind: 'duplicate' },
                { kind: 'increment' },
                i.storeOp,
                makeTarget("conditionTarget"),
                // condition
                { ...i.loadOp, location: stmt.getConditionOrThrow() },
                pushInt(10),
                { kind: 'lessthan' },
                // jump to start target
                { kind: 'jumpif', target: ops[1] },
                makeTarget("breakTarget"),
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
            expect(context.environStack).empty;
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
            expect(context.environStack).empty;
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
            expect(context.environStack).empty;
            expect(context.locals).empty;

            expectResults(ops,
                { kind: 'noop', location: stmt.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken) },
                { kind: 'noop', location: stmt.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken) },
            )
        });

        it("labeled block", () => {
            const contract = /*javascript*/ ` foo: { break foo; };`
            const { sourceFile } = createTestProject(contract);
            const scope = createTestScope();

            const stmt = sourceFile.forEachChildAsArray()[0].asKindOrThrow(tsm.SyntaxKind.LabeledStatement);
            const $break = stmt.getStatement().asKindOrThrow(tsm.SyntaxKind.Block).getStatements()[0];
            const { ops, context } = testAdaptStatement(scope, stmt);

            expect(context.scope).eq(scope);
            expect(context.environStack).empty;
            expect(context.locals).empty;

            expectResults(ops,
                { skip: true },
                { kind: 'jump', target: ops[3], location: $break },
                { skip: true },
                { kind: 'noop', debug: 'breakTarget foo' },
            )
        });
    });
})

