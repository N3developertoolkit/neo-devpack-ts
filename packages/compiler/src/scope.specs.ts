import { expect } from 'chai';
import 'mocha';

import { createScope, resolve } from './scope';
import { createContractProject } from './utils';
import * as O from 'fp-ts/Option'

describe("scope", () => {
    describe("resolve", () => {
        it("fails on empty scope", () => {
            const project = createContractProject();
            const sourceFile = project.createSourceFile("contract.ts");
            const funcDecl = sourceFile.addFunction({ name: "testFunction" });
            const symbol = funcDecl.getSymbolOrThrow();

            const scope = createScope()([]);
            const actual = resolve(scope)(symbol);
            expect(O.isNone(actual)).true;
        })
    })
})