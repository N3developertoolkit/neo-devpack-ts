import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'

import { GlobalScopeContext, makeCallableObject, makeInterface, makeMethod, makeProperty } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetOpsFunc } from "../types/CompileTimeObject";
import { ParseError, makeParseError } from "../utils";
import { Operation, pushInt } from "../types/Operation";

function invokeArray(node: tsm.NewExpression | tsm.CallExpression, args: readonly GetOpsFunc[]): E.Either<ParseError, CompileTimeObject> {

    // if there are no arguments, create an empty array
    if (ROA.isEmpty(args)) E.of(<CompileTimeObject>{ node, loadOps: [{ kind: 'newemptyarray' }] })

    // if there is only one argument and it is a number, create an array of that size empty slots
    // TODO: need a way to check the type of the args

    // otherwise, create an array from the args via packarray
    return pipe(
        args,
        ROA.map(arg => arg()),
        ROA.sequence(E.Applicative),
        E.map(ROA.flatten),
        E.map(ROA.concat<Operation>([
            pushInt(args.length),
            { kind: 'packarray' }
        ])),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

export function makeArray(ctx: GlobalScopeContext) {
    makeCallableObject(ctx, "Array",
        (node) => (_$this, args) => invokeArray(node, args),
        (node) => (_$this, args) => invokeArray(node, args));
    makeArrayInterface(ctx);
}

function makeArrayInterface(ctx: GlobalScopeContext) {
    const members = {
        length: makeProperty([{ kind: "size" }]),
        pop: makeMethod(callPop),
        push: makeMethod(callPush),
    }
    makeInterface(ctx, "Array", members);
}

const callPop: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        $this(),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

const callPush: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.bind("args", () => {
            return pipe(
                args,
                ROA.map(arg => {
                    return pipe(
                        arg(),
                        E.map(ROA.prepend<Operation>({ kind: 'duplicate' })),
                        E.map(ROA.append<Operation>({ kind: 'append' })),
                    )
                }),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten),
            )
        }),
        E.map(({ $this, args }) => {
            const loadOps = pipe(
                $this,
                ROA.concat(args),
                ROA.append<Operation>({ kind: 'size' }),
            )
            return <CompileTimeObject>{ node, loadOps }
        })
    )
}
