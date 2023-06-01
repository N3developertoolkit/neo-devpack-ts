import * as tsm from "ts-morph";

import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as STR from 'fp-ts/string';

import { CallInvokeResolver, CompileTimeObject, CompileTimeType, GetOpsFunc, GetValueFunc, InvokeResolver, PropertyResolver } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { ParseError, createDiagnostic, makeReadOnlyMap, single } from "../utils";
import { Operation } from "../types/Operation";

export interface GlobalScopeContext {
    readonly decls: readonly LibraryDeclaration[]
    readonly declMap: ReadonlyMap<string, readonly LibraryDeclaration[]>;

    addObject(obj: CompileTimeObject): void;
    addType(type: CompileTimeType): void;
    addError(error: string | tsm.ts.Diagnostic): void;
}

export function getVarDeclAndSymbol(ctx: GlobalScopeContext) {
    return (name: string) => {
        return pipe(
            ctx.declMap.get(name),
            O.fromNullable,
            O.map(ROA.filterMap(O.fromPredicate(tsm.Node.isVariableDeclaration))),
            O.chain(single),
            E.fromOption(() => `could not find ${name} variable`),
            E.bindTo('node'),
            E.bind('symbol', ({ node }) => pipe(node, TS.getSymbol, E.fromOption(() => `could not find symbol for ${name}`))),
        );
    }
}

export function makeProperties<T>(
    node: tsm.Node,
    fields: ROR.ReadonlyRecord<string, T>,
    makeProperty: (value: T) => (symbol: tsm.Symbol) => E.Either<string, CompileTimeObject>
): E.Either<string, ReadonlyMap<string, PropertyResolver>> {
    const type = node.getType();
    return pipe(
        fields,
        ROR.mapWithIndex((name, value) => pipe(
            type.getProperty(name),
            E.fromNullable(`could not find ${tsm.Node.hasName(node) ? node.getName() : "<unknown>"} ${name} property`),
            E.chain(makeProperty(value)),
            E.chain(cto => {
                if (!cto.symbol) return E.left(`could not find symbol for ${name}"}`);
                const resolver: PropertyResolver = () => E.of(cto);
                return E.of([cto.symbol.getName(), resolver] as const);
            })
        )),
        ROR.collect(STR.Ord)((_k, v) => v),
        ROA.sequence(E.Applicative),
        E.map(makeReadOnlyMap)
    );
}

export function makeInterface(name: string, members: ROR.ReadonlyRecord<string, (s: tsm.Symbol) => E.Either<string, PropertyResolver>>, ctx: GlobalScopeContext) {
    pipe(
        ctx.declMap.get(name),
        E.fromNullable(`could not find ${name} declarations`),
        E.map(ROA.filterMap(O.fromPredicate(tsm.Node.isInterfaceDeclaration))),
        E.chain(flow(ROA.head, E.fromOption(() => `could not find ${name} interface`))),
        E.map(decl => {
            const type = decl.getType();
            const properties = pipe(
                members,
                ROR.mapWithIndex((memberName, factory) => {
                    return pipe(
                        type.getProperty(memberName),
                        E.fromNullable(`could not find ${name}.${memberName} member`),
                        E.bindTo('symbol'),
                        E.bind('resolver', ({ symbol }) => factory(symbol)),
                        E.map(({ symbol, resolver }) => [symbol, resolver] as const)
                    );
                }),
                ROR.collect(STR.Ord)((_k, v) => v),
                ROA.separate,
                ({ left: errors, right: entries }) => {
                    errors.forEach(error => ctx.addError(createDiagnostic(error)));
                    return entries;
                },
                makeReadOnlyMap
            )

            return <CompileTimeType>{ type, properties };
        }),
        E.match(
            error => { ctx.addError(error) },
            ctx.addType
        )
    );
}

export function makeMethod(call: CallInvokeResolver) {
    return (symbol: tsm.Symbol): E.Either<string, PropertyResolver> => {
        return pipe(
            symbol,
            TS.getMethodSig,
            O.map(node => {
                const resolver: PropertyResolver = ($this) => pipe(
                    $this(),
                    E.map(loadOps => <CompileTimeObject>{ node: node, loadOps, call })
                )
                return resolver;
            }),
            E.fromOption(() => `could not find ${symbol.getName()} member`)
        );
    }
}