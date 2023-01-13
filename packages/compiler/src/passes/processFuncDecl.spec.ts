import { expect } from 'chai';
import 'mocha';
import * as tsm from "ts-morph";
import { createTestProjectContext } from '../testUtils';
import { processFunctionDeclaration } from './processFunctionDeclarations';

describe("processFunctionDeclaration", () => {
    it("symbol literal return", async () => {
        
        const src = /*javascript*/`
            /** @safe */
            export function symbol(foo:number) { return foo; }`

// # Method Start Symbol.DevHawk.Contracts.ApocToken
// # Code Apoc.cs line 37: "{"
// 0000 NOP
// # Code Apoc.cs line 38: "return SYMBOL;"
// 0001 PUSHDATA1 41-50-4F-43 # as text: "APOC"
// 0007 JMP_L 05-00-00-00 # pos: 12 (offset: 5)
// # Code Apoc.cs line 39: "}"
// 0012 RET
// # Method End Symbol.DevHawk.Contracts.ApocToken
        const { context, sourceFile } = await createTestProjectContext(src);
        const decl = sourceFile.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
        const body = decl.getBodyOrThrow() as tsm.Block;
        const retStmt = body.getStatements()[0] as tsm.ReturnStatement;

        const retVal = retStmt.getExpression() as tsm.Identifier;
        var paramDecl = retVal.getSymbol()!.getDeclarations()[0] as tsm.ParameterDeclaration;
        var funcDecl = paramDecl.getParentOrThrow() as tsm.FunctionDeclaration;
        var funcParamDecls = funcDecl.getParameters();



        // var foo = parent.getParameter(decls.getName())


        // const params = decl.getParameters();
        // const sym = params[0].getSymbolOrThrow();
        
        processFunctionDeclaration(decl, context);
    });
});