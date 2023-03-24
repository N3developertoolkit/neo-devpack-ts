import { expect } from 'chai';
import 'mocha';

import { createEmptyScope, createScope, resolve } from './scope';
import { createProject } from './utils';
import * as O from 'fp-ts/Option'
import { makeTestScope } from './utils.spec';

describe("scope", () => {
    describe("resolve", () => {
        const project = createProject();
        const sourceFile = project.createSourceFile("contract.ts");
        const funcDecl = sourceFile.addFunction({ name: "testFunction" });
        const symbol = funcDecl.getSymbolOrThrow();
        const type = funcDecl.getType();

        it("smoke test - none", () => {
            const scope = createEmptyScope();
            const actual = resolve(scope)(symbol);
            expect(O.isNone(actual)).true;
        });

        it("smoke test - some", () => {
            const def = { symbol, type }
            const scope = makeTestScope()([def]);
            const actual = resolve(scope)(symbol);
            expect(O.isSome(actual)).true;
        })
    })
})