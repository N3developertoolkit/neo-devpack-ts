import * as tsm from "ts-morph";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord';

import { GlobalScopeContext, getVarDeclAndSymbol, makeProperties } from "./types";
import { CallInvokeResolver, CompileTimeObject, GetValueFunc } from "../types/CompileTimeObject";
import { createDiagnostic, makeParseError, single } from "../utils";
import { Operation, isPushDataOp, isPushIntOp } from "../types/Operation";
import { makePropResolvers } from "../passes/parseDeclarations";
import { sc, u } from "@cityofzion/neon-core";

function getCompileTimeString(cto: CompileTimeObject): O.Option<string> {
    if (tsm.Node.isStringLiteral(cto.node)) return O.of(cto.node.getLiteralText());

    return pipe(
        cto.loadOps,
        ROA.filter(op => op.kind !== 'noop'),
        single,
        O.chain(O.fromPredicate(isPushDataOp)),
        O.chain(op => O.tryCatch(() => Buffer.from(op.value).toString()))
    )
}

function getCompileTimeInteger(cto: CompileTimeObject): O.Option<bigint> {
    if (tsm.Node.isBigIntLiteral(cto.node)) return O.of(cto.node.getLiteralValue() as bigint);
    if (tsm.Node.isNumericLiteral(cto.node)) {
        const value = cto.node.getLiteralValue();
        return O.tryCatch(() => BigInt(value))
    }

    return pipe(
        cto.loadOps,
        ROA.filter(op => op.kind !== 'noop'),
        single,
        O.chain(O.fromPredicate(isPushIntOp)),
        O.map(op => op.value)
    );
}

function getFirstArg(node: tsm.Node) {
    return (args: readonly GetValueFunc[]) => {
        return pipe(
            args,
            ROA.head,
            E.fromOption(() => makeParseError(node)("invalid arg count")),
            E.chain(arg => arg()),
        )
    }
}

const fromHex: CallInvokeResolver = (node) => ($this, args) => {
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

const fromInteger: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        args,
        getFirstArg(node),
        E.map(arg => {
            const loadOps = pipe(arg,
                getCompileTimeInteger,
                O.match(
                    () => pipe(arg.loadOps, ROA.append<Operation>({ kind: "convert", type: sc.StackItemType.ByteString })),
                    value => {
                        const twos = u.BigInteger.fromNumber(value.toString()).toReverseTwos();
                        return ROA.of<Operation>({ kind: "pushdata", value: Buffer.from(twos, 'hex') });
                    }
                )
            )
            return <CompileTimeObject>{ node: arg.node, loadOps };
        })
    );
}

const fromString: CallInvokeResolver = (node) => ($this, args) => {
    return pipe(
        args,
        getFirstArg(node),
    );
}

function makeByteStringObject(ctx: GlobalScopeContext) {
    const bytestringProps: ROR.ReadonlyRecord<string, CallInvokeResolver> = {
        fromHex, fromInteger, fromString
    }

   pipe(
        "ByteString",
        getVarDeclAndSymbol(ctx),
        E.bind('props', ({ node }) => makeProperties<CallInvokeResolver>(node, bytestringProps, makeProperty)),
        E.map(({ node, symbol, props }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties: makePropResolvers(props) }),
        E.match(
            error => { ctx.addError(createDiagnostic(error)) },
            ctx.addObject
        )
    )

    function makeProperty(call: CallInvokeResolver) {
        return (symbol: tsm.Symbol): E.Either<string, CompileTimeObject> => {
            return pipe(
                symbol.getValueDeclaration(),
                O.fromNullable,
                O.chain(O.fromPredicate(tsm.Node.isMethodSignature)),
                E.fromOption(() => `could not find method signature for ${symbol.getName()}`),
                E.map(node => {
                    // const op = <Operation>{ kind: 'syscall', name: syscall }
                    return <CompileTimeObject>{ node, symbol, loadOps: [], call };
                })
            )
        }
    }
}

export function makeByteString(ctx: GlobalScopeContext) {
    makeByteStringObject(ctx);
}