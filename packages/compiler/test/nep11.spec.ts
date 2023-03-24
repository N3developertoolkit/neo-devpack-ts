import 'mocha';
import { assert, expect } from 'chai';

import * as tsm from "ts-morph";

import { identity, pipe } from 'fp-ts/function';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as ROA from 'fp-ts/ReadonlyArray';

import { createTestProject } from '../src/utils.spec';
import { Operation } from '../src/types/Operation';
import { parseExpression } from '../src/passes/expressionProcessor';
import { Scope, SymbolDef } from '../src/types/ScopeType';
import { makeParseError } from '../src/symbolDef';

describe("nep11", () => {
    it("object literal", () => {
        
    })
})