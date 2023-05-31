import * as tsm from "ts-morph";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as S from 'fp-ts/State';
import * as TS from "../TS";

import { GlobalScopeContext, getVarDeclAndSymbol } from "./types";
import { CallInvokeResolver, CompileTimeObject, GetValueFunc, NewInvokeResolver } from "../types/CompileTimeObject";
import { ParseError, createDiagnostic, single } from "../utils";
import { pushString } from "../types/Operation";

function invokeError(node: tsm.CallExpression | tsm.NewExpression, args: readonly GetValueFunc[]): E.Either<ParseError, CompileTimeObject> {
    return pipe(
        args,
        ROA.head,
        O.match(
            () => E.of(<CompileTimeObject>{ node, loadOps: [pushString("")] }),
            arg => arg()
        )
    )
}

export function makeError(ctx: GlobalScopeContext) {
    const q = pipe(
        "Error",
        getVarDeclAndSymbol(ctx),
        E.map(({ node, symbol }) => {
            const call: CallInvokeResolver = (node) => ($this, args) => invokeError(node, args)
            const callNew: NewInvokeResolver = (node) => ($this, args) => invokeError(node, args)
            return <CompileTimeObject>{ node, symbol, loadOps: [], call, callNew };
        }),
        E.match(
            () => ctx.addError(createDiagnostic("could not find Error declaration")),
            ctx.addObject
        )
    );
}