import { expect } from 'chai';
import 'mocha';

import { createScope, resolve } from './scope';
import { createProject } from './utils';
import * as O from 'fp-ts/Option'

describe("scope", () => {
    describe("resolve", () => {
        const project = createProject();
        const sourceFile = project.createSourceFile("contract.ts");
        const funcDecl = sourceFile.addFunction({ name: "testFunction" });
        const symbol = funcDecl.getSymbolOrThrow();
        const type = funcDecl.getType();

        it("smoke test - none", () => {
            const scope = createScope()([]);
            const actual = resolve(scope)(symbol);
            expect(O.isNone(actual)).true;
        });

        it("smoke test - some", () => {
            const def = { symbol, type }
            const scope = createScope()([def]);
            const actual = resolve(scope)(symbol);
            expect(O.isSome(actual)).true;
        })
    })
})