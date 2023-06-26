import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from '../TS'

import { GlobalScopeContext, makeCallableObject, makeInterface, makeMethod, makeProperty } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetOpsFunc } from "../types/CompileTimeObject";
import { CompileError, ParseError, makeParseError } from "../utils";
import { Operation, pushInt } from "../types/Operation";

function invokeArray(node: tsm.NewExpression | tsm.CallExpression, args: readonly GetOpsFunc[]): E.Either<ParseError, CompileTimeObject> {

    // if there are no arguments, create an empty array
    if (ROA.isEmpty(args)) E.of(<CompileTimeObject>{ node, loadOps: [{ kind: 'newemptyarray' }] })

    // if there is only one argument and it is a number, create an array of that size empty slots
    // TODO: need a way to check the type of the args
    if (args.length === 1) {
        const nodeArgs = TS.getArguments(node);
        if (nodeArgs.length !== args.length) throw new CompileError("Mismatched arg count", node);
        const type = nodeArgs[0].getType();
        if (type.isNumber()) {
            return pipe(
                args[0](),
                E.map(ROA.concat<Operation>([{ kind: 'newarray' }])),
                E.map(loadOps => <CompileTimeObject>{ node, loadOps })
            )
        }
    }

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
        at: makeMethod(callAt),
        pop: makeMethod(callPop),
        push: makeMethod(callPush),
        reverse: makeMethod(callReverse),
        shift: makeMethod(callShift),
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

const callAt: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.bind("arg", () => {
            return pipe(
                args,
                ROA.lookup(0),
                E.fromOption(() => makeParseError(node)("Expected one argument")),
                E.chain(arg => arg()),
            )
        }),
        E.map(({ $this, arg }) => {
            const loadOps = pipe(
                $this, 
                ROA.concat(arg),
                ROA.concat<Operation>([
                    // check to see if index arg is positive or negative
                    { kind: 'duplicate' },
                    pushInt(0), 
                    { kind: 'jumpge', offset: 4 }, 
                    // if negative, add array length to arg to get the index
                    { kind: 'over' }, // copy $this to top of stack
                    { kind: 'size' }, // get size of array
                    { kind: 'add' }, // add size to arg
                    // Stack at this point is [this, index]
                    // push null on the stack if index is less than zero
                    { kind: 'duplicate' }, 
                    pushInt(0), 
                    { kind: 'jumpge', offset: 5 },
                    { kind: 'drop' }, // drop size from stack
                    { kind: 'drop' }, // drop $this from stack
                    { kind: 'pushnull' }, 
                    { kind: 'jump', offset: 10 }, 
                    // Stack at this point is [this, index]
                    // push null on the stack if index is greater than or equal to array length
                    { kind: 'over' }, // copy $this to top of stack 
                    { kind: 'size' }, // get size of array 
                    { kind: 'over' }, // copy index to top of stack
                    { kind: 'jumpge', offset: 5 },
                    { kind: 'drop' }, // drop size from stack
                    { kind: 'drop' }, // drop $this from stack 
                    { kind: 'pushnull' },
                    { kind: 'jump', offset: 2 },
                    // otherwise, index is valid, so get the value at that index
                    { kind: "pickitem"}, 
                    { kind: "noop"} // jump target for index < 0 or index >= size
                ])
            );
            return <CompileTimeObject>{ node, loadOps }
        })
    );
}

const callShift: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.map(({ $this }) => {
            const loadOps = pipe(
                $this, 
                ROA.concat<Operation>([
                    // pick the first item of the array
                    { kind: 'duplicate' },
                    pushInt(0),
                    { kind: 'pickitem' },
                    // drop the first item of the array
                    { kind: 'swap' }, // stack was [this item], now [item this]
                    pushInt(0),
                    { kind: 'removeitem'}
                ])
            );
            return <CompileTimeObject>{ node, loadOps }
        })
    );
}

const callReverse: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        E.Do,
        E.bind("$this", () => $this()),
        E.map(({ $this }) => {
            const loadOps = pipe(
                $this, 
                ROA.concat<Operation>([
                    { kind: 'reverseitems' },
                ])
            );
            return <CompileTimeObject>{ node, loadOps }
        })
    );
}
