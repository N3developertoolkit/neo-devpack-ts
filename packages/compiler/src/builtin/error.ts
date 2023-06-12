import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'

import { GlobalScopeContext, getVarDeclAndSymbol } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetOpsFunc, NewInvokeResolver } from "../types/CompileTimeObject";
import { ParseError, createDiagnostic } from "../utils";
import { Operation, pushString } from "../types/Operation";

function invokeError(node: tsm.CallExpression | tsm.NewExpression, args: readonly GetOpsFunc[]): E.Either<ParseError, CompileTimeObject> {
    return pipe(
        args,
        ROA.head,
        O.match(
            () => pipe(pushString(""), ROA.of<Operation>, E.of),
            arg => arg()
        ),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

export function makeError(ctx: GlobalScopeContext) {
    pipe(
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