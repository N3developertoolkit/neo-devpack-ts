import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from "../TS";

import { GlobalScopeContext, parseArguments } from "./types";
import { CompileTimeObject, InvokeResolver } from "../types/CompileTimeObject";
import { createDiagnostic, makeParseError, single } from "../utils";
import { Operation, pushInt } from "../types/Operation";

export function makeCallContract(ctx: GlobalScopeContext) {

    pipe(
        ctx.declMap.get("callContract") ?? [],
        ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
        single,
        O.bindTo("node"),
        O.bind("symbol", ({ node }) => TS.getSymbol(node)),
        O.map(({ node, symbol }) => {
            const resolver: InvokeResolver = ($this, args) => {
                const callArgs = args.slice(0, 3);
                const targetArgs = args.slice(3);

                if (callArgs.length !== 3) {
                    return E.left(makeParseError(node)("invalid arg count"));
                }

                return pipe(
                    targetArgs,
                    parseArguments,
                    E.map(ROA.concat<Operation>([
                        pushInt(targetArgs.length),
                        { kind: 'packarray' },
                    ])),
                    E.bindTo('targetOps'),
                    E.bind('callOps', () => pipe(
                        callArgs,
                        parseArguments,
                        E.map(ROA.append<Operation>({ kind: "syscall", name: "System.Contract.Call" })),
                    )),
                    E.map(({ targetOps, callOps }) => ROA.concat<Operation>(callOps)(targetOps)),
                    E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                )
            }
            return <CompileTimeObject>{ node, symbol, loadOps: [], call: resolver };
        }),
        O.match(
            () => ctx.addError(createDiagnostic("could not find callContract function")),
            ctx.addObject
        )
    )
}