import 'mocha';
import { assert, expect } from 'chai';

import * as tsm from "ts-morph";

import { identity, pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray';

import { createTestProject, testRight } from '../src/utils.spec';
import { Operation } from '../src/types/Operation';
import { parseExpression } from '../src/passes/expressionProcessor';
import { ParseError, Scope, SymbolDef } from '../src/types/ScopeType';
import { makeParseError } from '../src/symbolDef';
import { makeFunctionScope } from '../src/passes/functionDeclarationProcessor';

const TOKEN_STATE = /*javascript*/`
/** @struct */
interface TokenState
{
    owner: ByteString,
    name: string,
    description: string,
    image: string,
}
`
const makeTestFunctionScope =
    (scope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<ParseError, Scope> => {
            return pipe(
                node,
                makeFunctionScope(scope),
                E.match(
                    errors => {
                        if (errors.length > 1) {
                            expect.fail(errors.map(e => e.message).join(', '));
                        }
                        return E.left(errors[0]);
                    },
                    scope => E.of(scope)
                )
            )
        }

describe("nep11", () => {
    it("object literal", () => {
        const contract = /*javascript*/`
${TOKEN_STATE}
export function mint(owner: ByteString, name: string, description: string, image: string) {
    const tokenState = { owner, name, description, image, };
}`;

        const { sourceFile, globalScope } = createTestProject(contract);
        const func = sourceFile.getFirstChildByKindOrThrow(tsm.SyntaxKind.FunctionDeclaration);
        const varstmt = func.getBodyOrThrow().getFirstChildByKindOrThrow(tsm.SyntaxKind.VariableStatement);
        const expr = varstmt.getDeclarations()[0].getInitializerOrThrow();


        const q = pipe(
            func,
            makeTestFunctionScope(globalScope),
            E.chain(scope => parseExpression(scope)(expr)),
            testRight(e => e.message)
        )
    })
})
