import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'

import { GlobalScopeContext, makeCallableObject } from "./common";
import { CompileTimeObject, GetOpsFunc } from "../types/CompileTimeObject";
import { ParseError } from "../utils";
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
    makeCallableObject(ctx, "Error", (node) => (_$this, args) => invokeError(node, args), (node) => (_$this, args) => invokeError(node, args));
}
