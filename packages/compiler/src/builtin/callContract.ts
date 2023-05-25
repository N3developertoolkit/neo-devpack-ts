import * as tsm from "ts-morph";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as S from 'fp-ts/State';
import * as TS from "../TS";

import { GlobalScopeContext } from "./types";
import { CompileTimeObject } from "../types/CompileTimeObject";
import { createDiagnostic, single } from "../utils";

export function makeCallContract(ctx: GlobalScopeContext) {
    pipe(
        ctx.declMap.get("callContract") ?? [],
        ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
        single,
        O.bindTo("node"),
        O.bind("symbol", ({ node }) => TS.getSymbol(node)),
        // TODO: real CTO
        O.map(({ node, symbol }) => <CompileTimeObject>{ node, symbol, loadOps: [] }),
        O.match(
            () => ctx.addError(createDiagnostic("could not find callContract function")),
            ctx.addObject
        )
    )
}