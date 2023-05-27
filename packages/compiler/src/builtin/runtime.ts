import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from "../TS";

import { GlobalScopeContext, getVarDecl } from "./types";
import { Operation } from "../types/Operation";
import { CompileTimeObject } from "../types/CompileTimeObject";
import { makePropResolvers } from "../passes/parseDeclarations";
import { createDiagnostic } from "../utils";



export function makeRuntime(ctx: GlobalScopeContext) {
    pipe(
        "Runtime",
        getVarDecl(ctx),
        E.bindTo('node'),
        E.bind('symbol', ({node}) => pipe(node, TS.getSymbol, E.fromOption(() => "could not find symbol for Runtime"))),
        E.bind('props', ({ node }) => pipe(
            node.getType().getProperties(),
            ROA.map(makeProperty),
            ROA.sequence(E.Applicative)
        )),
        E.map(({ node, symbol, props }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties: makePropResolvers(props) }),
        E.match(
            error => { ctx.addError(createDiagnostic(error)) },
            ctx.addObject
        )
    )

    function makeProperty(symbol: tsm.Symbol): E.Either<string, CompileTimeObject> {
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
            E.map(({ node, op }) => <CompileTimeObject>{ node, symbol, loadOps: [op] })
        )
    }
}