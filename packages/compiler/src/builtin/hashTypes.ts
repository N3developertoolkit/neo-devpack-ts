import * as tsm from "ts-morph";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from "../TS";

import { GlobalScopeContext, callNoOp, getIsValidOps, makeInterface, makeMethod, makeObject, makeProperty, makeStaticProperty, } from "./common";
import { CallInvokeResolver, CompileTimeObject, GetOpsFunc, PropertyResolver } from "../types/CompileTimeObject";
import { createDiagnostic, makeParseError, single } from "../utils";
import { Operation, isPushDataOp, isPushIntOp, pushInt, pushString } from "../types/Operation";
import { sc, u } from "@cityofzion/neon-core";

function makeMembers(size: number) {
    const $static = {
        zero: makeStaticProperty([{ kind: "pushdata", value: Buffer.alloc(size) }]),
    }

    const instance = {
        isZero: makeProperty([pushInt(0), { kind: "numequal" }]),
        valid: makeProperty(getIsValidOps(size)),
        asByteString: makeMethod(callNoOp),
    }

    return { instance, $static };
}

const callAsAddress: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        $this(),
        E.bindTo("thisOps"),
        E.bind('arg1Ops', () => pipe(args,
            ROA.head,
            O.getOrElse(() => () => E.of(ROA.of<Operation>({ kind: 'syscall', name: "System.Runtime.GetAddressVersion" }))),
            arg => arg(),
        )),
        E.map(({ thisOps, arg1Ops }) => {
            const hash = u.HexString.fromHex("0xacce6fd80d44e1796aa0c2c625e9e4e0ce39efc0", true);
            const token = new sc.MethodToken({
                hash: hash.toString(),
                method: "base58CheckEncode",
                parametersCount: 0,
                hasReturnValue: true,
                callFlags: sc.CallFlags.All
            })
            return pipe(
                arg1Ops,
                ROA.concat(thisOps),
                ROA.append<Operation>({ kind: 'concat' }),
                ROA.append<Operation>({ kind: 'calltoken', token }),
            )
        }),
        E.map(loadOps => <CompileTimeObject>{ node, loadOps })
    )
}

function makeHash160(ctx: GlobalScopeContext) {
    const name = "Hash160";
    const { instance, $static } = makeMembers(20);
    makeObject(ctx, name, $static);
    makeInterface(ctx, name, { ...instance, asAddress: makeMethod(callAsAddress) });
}

function makeHash256(ctx: GlobalScopeContext) {
    const name = "Hash256";
    const { instance, $static } = makeMembers(32);
    makeObject(ctx, name, $static);
    makeInterface(ctx, name, instance);
}

function makeECPoint(ctx: GlobalScopeContext) {
    const members = {
        valid: makeProperty(getIsValidOps(33)),
        asByteString: makeMethod(callNoOp),
    }
    makeInterface(ctx, "ECPoint", members);
}

export function makeHashTypes(ctx: GlobalScopeContext) {
    makeHash160(ctx);
    makeHash256(ctx);
    makeECPoint(ctx);
}

