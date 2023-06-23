import * as tsm from "ts-morph";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'

import { GlobalScopeContext, makeInterface, makeMethod, makeObject, makeProperty, makeStaticMethod } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetOpsFunc } from "../types/CompileTimeObject";
import { makeParseError, single } from "../utils";
import { Operation, isPushDataOp, isPushIntOp, pushInt } from "../types/Operation";
import { sc, u } from "@cityofzion/neon-core";

function getCompileTimeString(ops: readonly Operation[]): O.Option<string> {
    return pipe(
        ops,
        ROA.filter(op => op.kind !== 'noop'),
        single,
        O.chain(O.fromPredicate(isPushDataOp)),
        O.chain(op => O.tryCatch(() => Buffer.from(op.value).toString()))
    )
}

function getCompileTimeInteger(ops: readonly Operation[]): O.Option<bigint> {
    return pipe(
        ops,
        ROA.filter(op => op.kind !== 'noop'),
        single,
        O.chain(O.fromPredicate(isPushIntOp)),
        O.map(op => op.value)
    );
}

function getFirstArg(node: tsm.Node) {
    return (args: readonly GetOpsFunc[]) => {
        return pipe(
            args,
            ROA.head,
            E.fromOption(() => makeParseError(node)("invalid arg count")),
            E.chain(arg => arg()),
        )
    }
}

const fromHex: CallInvokeResolver = (node) => (_$this, args) => {
    return pipe(
        args,
        getFirstArg(node),
        E.chain(flow(
            getCompileTimeString,
            E.fromOption(() => makeParseError(node)("fromHex requires a string literal argument"))
        )),
        E.map(str => {
            return str.startsWith("0x") || str.startsWith("0X") ? str.slice(2) : str;
        }),
        E.chain(str => {
            const value = Buffer.from(str, "hex");
            return value.length === 0 && str.length > 0
                ? E.left(makeParseError(node)("invalid hex string"))
                : E.of(value)
        }),
        E.map(value => ROA.of<Operation>({ kind: "pushdata", value })),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
};

const fromInteger: CallInvokeResolver = (node) => (_$this, args) => {
    return pipe(
        args,
        getFirstArg(node),
        E.map(ops => {
            const loadOps = pipe(ops,
                getCompileTimeInteger,
                O.match(
                    () => pipe(ops, ROA.append<Operation>({ kind: "convert", type: sc.StackItemType.ByteString })),
                    value => {
                        const twos = u.BigInteger.fromNumber(value.toString()).toReverseTwos();
                        return ROA.of<Operation>({ kind: "pushdata", value: Buffer.from(twos, 'hex') });
                    }
                )
            )
            return <CompileTimeObject>{ node, loadOps };
        })
    );
}

const fromString: CallInvokeResolver = (node) => (_$this, args) => {
    return pipe(
        args, 
        getFirstArg(node),
        E.map(loadOps =><CompileTimeObject>{ node, loadOps })
    );
}

function makeByteStringObject(ctx: GlobalScopeContext) {
    const members = {
        fromHex: makeStaticMethod(fromHex),
        fromInteger: makeStaticMethod(fromInteger),
        fromString: makeStaticMethod(fromString),
    }
    makeObject(ctx, "ByteString", members);
}

const callAsInteger: CallInvokeResolver = (node) => ($this) => {
    return pipe(
        $this(),
        E.map(ROA.concat<Operation>([
            { kind: 'duplicate'},
            { kind: 'isnull'},
            { kind: 'jumpifnot', offset: 4 },
            { kind: 'drop' },
            pushInt(0),
            { kind: 'jump', offset: 2 },
            { kind: "convert", type: sc.StackItemType.Integer }
        ])),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
};

const callAsHash160: CallInvokeResolver = (node) => ($this) => {
    return pipe(
        $this(),
        E.map(ROA.concat<Operation>([
            { kind: 'duplicate'},
            { kind: 'isnull'},
            { kind: 'jumpif', offset: 5 }, // if null, jump to throw
            { kind: 'duplicate'},
            { kind: 'size'},
            pushInt(20),
            { kind: 'jumpeq', offset: 2 },
            { kind: 'throw' }
        ])),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

const callAsHash256: CallInvokeResolver = (node) => ($this) => {
    return pipe(
        $this(),
        E.map(ROA.concat<Operation>([
            { kind: 'duplicate'},
            { kind: 'isnull'},
            { kind: 'jumpif', offset: 5 }, // if null, jump to throw
            { kind: 'duplicate'},
            { kind: 'size'},
            pushInt(32),
            { kind: 'jumpeq', offset: 2 },
            { kind: 'throw' }
        ])),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

const callAsECPoint: CallInvokeResolver = (node) => ($this) => {
    return pipe(
        $this(),
        E.map(ROA.concat<Operation>([
            { kind: 'duplicate'},
            { kind: 'isnull'},
            { kind: 'jumpif', offset: 5 }, // if null, jump to throw
            { kind: 'duplicate'},
            { kind: 'size'},
            pushInt(33),
            { kind: 'jumpeq', offset: 2 },
            { kind: 'throw' }
        ])),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

function makeByteStringInterface(ctx: GlobalScopeContext) {
    const members = {
        length: makeProperty([{ kind: "size" }]),
        asInteger: makeMethod(callAsInteger),
        asHash160: makeMethod(callAsHash160),
        asHash256: makeMethod(callAsHash256),
        asECPoint: makeMethod(callAsECPoint)
    }
    makeInterface(ctx, "ByteString", members);
}

export function makeByteString(ctx: GlobalScopeContext) {
    makeByteStringObject(ctx);
    makeByteStringInterface(ctx);
}


