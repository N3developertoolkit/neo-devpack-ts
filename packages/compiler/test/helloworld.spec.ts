import 'mocha';
import { assert, expect } from 'chai';
// import { createTestProject, makeTestScope } from '../src/utils.spec';

// import * as tsm from "ts-morph";
// import { SymbolDef } from '../src/types/ScopeType';
// import { Operation } from '../src/types/Operation';
// import { parseExpressionStatement, parseFunctionDeclaration, parseVariableStatement } from '../src/passes/functionDeclarationProcessor';
// import { parseExpression } from '../src/passes/expressionProcessor';


// describe()

// describe("interface", () => {
//     const contract = /*javascript*/`
//     interface TestInterface { name: string, owner: ByteString, count: number };
    
//     export function test1(name: string, owner: ByteString, count: number) {
//         const data: TestInterface = { name, owner, count };
//     }
    
//     export function test1a(name: string, owner: ByteString, count: number) {
//         const data = { name, owner, count } as TestInterface;
//     }
    
//     export function test1b(name: string, owner: ByteString, count: number) {
//         let data: TestInterface;
//         data = { name, owner, count };
//     }`;

//     const { sourceFile, globalScope } = createTestProject(contract);

//     function makeFuncCtx(decl: tsm.FunctionDeclaration) {
//         const params = decl.getParameters().map((p, i) => ({
//             symbol: p.getSymbolOrThrow(),
//             type: p.getType(),
//             loadOps: [{ 
//                 kind: "loadarg", 
//                 index: i,
//                 debug: p.getSymbolOrThrow().getName() 
//             } as Operation ],
//         }))
//         return {
//             scope: makeTestScope(globalScope)(params),
//             locals: [],
//             errors: []
//         }
//     }

//     it("var statement defined assignmnet", () => {
//         const func = sourceFile.getChildrenOfKind(tsm.SyntaxKind.FunctionDeclaration)[0];
//         const ctx = makeFuncCtx(func);
//         const body = func.getBodyOrThrow() as tsm.Block;
//         const stmt = body.getStatements()[0] as tsm.VariableStatement;
//         const result = parseVariableStatement(stmt)(ctx);
//     });

//     it("var statement as assignment", () => {
//         const func = sourceFile.getChildrenOfKind(tsm.SyntaxKind.FunctionDeclaration)[1];
//         const ctx = makeFuncCtx(func);
//         const body = func.getBodyOrThrow() as tsm.Block;
//         const stmt = body.getStatements()[0] as tsm.VariableStatement;
//         const result = parseVariableStatement(stmt)(ctx);
//     })

//     it("expression assignment", () => {
//         const func = sourceFile.getChildrenOfKind(tsm.SyntaxKind.FunctionDeclaration)[2];
//         const stmt = (func.getBodyOrThrow() as tsm.Block).getStatements()[1];
//         const t = stmt.getType();
//         const qqq = t.getText();
//         const result = parseFunctionDeclaration(globalScope)(func);


//     })

// });

// // describe("helloworld", () => {
// //     it("update", () => {
// //         const contract = /*javascript*/`
// //             export function update(nefFile: ByteString, manifest: string) {
// //                 const OWNER_KEY = ByteString.fromHex("0xFF");
// //                 const owner = Storage.context.get(OWNER_KEY);
// //                 if (owner && checkWitness(owner)) {
// //                     ContractManagement.update(nefFile, manifest);
// //                 } else {
// //                     throw Error("Only the contract owner can update the contract");
// //                 }
// //             }`;

// //         const { sourceFile, globalScope } = createTestProject(contract);

// //         // const init = sourceFile.addFunction({
// //         //     name: "test",
// //         //     isExported: true,
// //         //     returnType: "boolean"
// //         // });
// //         // const symbol = init.getSymbol();
// //         // const t = init.getReturnType();

// //         // init.remove();
// //         // const q  = symbol?.getName();
// //         // const qq = t.getText();
// //         // const qqq = t.isBoolean();
        

// //         const func = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
// //         const owner = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration).find(d => d.getSymbol()?.getName() === "owner");
// //         expect(owner).is.not.undefined;

// //         const pbr = pipe(
// //             func,
// //             makeFunctionDeclScope(globalScope),
// //             E.map(updateScope({
// //                 symbol: owner!.getSymbolOrThrow(),
// //                 type: owner!.getType(),
// //                 loadOps: [{
// //                     kind: "loadlocal",
// //                     index: 0,
// //                     debug: "owner"
// //                 } as Operation]
// //             })),
// //             E.chain(scope => pipe(
// //                 func.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.IfStatement).getExpression(),
// //                 parseExpression(scope),
// //                 E.mapLeft(ROA.of)
// //             )),
// //             E.match(
// //                 errors => expect.fail(errors.map(e => e.message).join(', ')),
// //                 identity
// //             )
// //         );

// //         // const qq = pipe(pbr.operations, convertJumpTargetOps, testRight);
// //         // const qqq = pipe(qq, convertJumpOffsetOps, testRight);
// //     })
// // })