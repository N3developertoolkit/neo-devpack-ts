import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from "../TS";

import { GlobalScopeContext, getVarDeclAndSymbol } from "./common";
import { Operation } from "../types/Operation";
import { CompileTimeObject, PropertyResolver } from "../types/CompileTimeObject";
import { createDiagnostic, makeReadOnlyMap } from "../utils";

export function makeRuntime(ctx: GlobalScopeContext) {
    pipe(
        "Runtime",
        getVarDeclAndSymbol(ctx),
        E.bind('properties', ({ node }) => pipe(
            node.getType().getProperties(),
            ROA.map(makeProperty),
            ROA.sequence(E.Applicative),
            E.map(makeReadOnlyMap)
        )),
        E.map(({ node, symbol, properties }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties }),
        E.match(
            error => { ctx.addError(createDiagnostic(error)) },
            ctx.addObject
        )
    )

    function makeProperty(symbol: tsm.Symbol): E.Either<string, readonly [string, PropertyResolver]> {
        return pipe(
            symbol.getValueDeclaration(),
            O.fromNullable,
            O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
            E.fromOption(() => `could not find property signature for ${symbol.getName()}`),
            E.bindTo('node'),
            E.bind('op', ({ node }) => pipe(
                node,
                TS.getTagComment('syscall'),
                E.fromOption(() => `could not find syscall tag for ${symbol.getName()}`),
                E.map(name => <Operation>{ kind: 'syscall', name })
            )),
            E.map(({ node, op }) => {
               const resolver: PropertyResolver = () => E.of( <CompileTimeObject>{ node, symbol, loadOps: [op] });
               return [symbol.getName(), resolver] as const;
            })
        )
    }
}