import 'mocha';
import { assert, expect } from 'chai';

import * as tsm from "ts-morph";

import { identity, pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray';

import { createTestProject, testRight } from '../src/utils.spec';
import { makeFunctionDeclScope, parseBody } from '../src/passes/functionDeclarationProcessor'
import { convertJumpOffsetOps, convertJumpTargetOps, Operation } from '../src/types/Operation';
import { parseExpression } from '../src/passes/expressionProcessor';
import { updateScope as $updateScope } from '../src/scope';
import { Scope, SymbolDef } from '../src/types/ScopeType';

const updateScope = (def: SymbolDef) => (scope: Scope) => $updateScope(scope)([def]);




describe("helloworld", () => {
    it("update", () => {
        const contract = /*javascript*/`
            export function update(nefFile: ByteString, manifest: string) {
                const OWNER_KEY = ByteString.fromHex("0xFF");
                const owner = Storage.context.get(OWNER_KEY);
                if (owner && checkWitness(owner)) {
                    ContractManagement.update(nefFile, manifest);
                } else {
                    throw Error("Only the contract owner can update the contract");
                }
            }`;

        const { sourceFile, scope } = createTestProject(contract);
        const func = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
        const ifStmt = func.getFirstDescendantByKindOrThrow(tsm.SyntaxKind.IfStatement);
        const owner = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration).find(d => d.getSymbol()?.getName() === "owner");
        expect(owner).is.not.undefined;
        
        
        const pbr = pipe(
            func,
            makeFunctionDeclScope(scope),
            E.map(updateScope({
                symbol: owner!.getSymbolOrThrow(),
                type: owner!.getType(),
                loadOps: [{
                    kind: "loadlocal",
                    index: 0,
                    debug: "owner"
                } as Operation]
            })),
            E.chain(scope => pipe(
                ifStmt.getExpression(),
                parseExpression(scope),
                E.mapLeft(ROA.of)
            )),
            E.match(
                errors => expect.fail(errors.map(e => e.message).join(', ')),
                identity
            )
        );

        // const qq = pipe(pbr.operations, convertJumpTargetOps, testRight);
        // const qqq = pipe(qq, convertJumpOffsetOps, testRight);
    })
})