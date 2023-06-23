import * as tsm from "ts-morph";

import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as STR from 'fp-ts/string';

import { CallInvokeResolver, CompileTimeObject, CompileTimeType, GetOpsFunc, NewInvokeResolver, PropertyResolver } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { E_fromSeparated, createDiagnostic, makeParseError, makeReadOnlyMap, single } from "../utils";
import { Operation, pushInt } from "../types/Operation";

export interface GlobalScopeContext {
    readonly decls: readonly LibraryDeclaration[]
    readonly declMap: ReadonlyMap<string, readonly LibraryDeclaration[]>;

    addObject(obj: CompileTimeObject): void;
    addType(type: CompileTimeType): void;
    addError(error: string | tsm.ts.Diagnostic): void;
}

export function getVarDecl(ctx: GlobalScopeContext) {
    return (name: string) => {
        return pipe(
            ctx.declMap.get(name),
            O.fromNullable,
            O.map(ROA.filterMap(O.fromPredicate(tsm.Node.isVariableDeclaration))),
            O.chain(single),
            E.fromOption(() => `could not find ${name} variable`),
        );
    }
}

export function getVarDeclAndSymbol(ctx: GlobalScopeContext) {
    return (name: string) => {
        return pipe(
            name,
            getVarDecl(ctx),
            E.bindTo('node'),
            E.bind('symbol', ({ node }) => pipe(node, TS.getSymbol, E.fromOption(() => `could not find symbol for ${name}`))),
        );
    }
}

export type PropResolverFactory = (s: tsm.Symbol) => E.Either<string, PropertyResolver>;

function makePropertyMap(type: tsm.Type, members: ROR.ReadonlyRecord<string, PropResolverFactory>) {
    return pipe(
        members,
        ROR.mapWithIndex((memberName, factory) => {
            return pipe(
                type.getProperty(memberName),
                E.fromNullable(`could not find ${type.getText()}.${memberName} member`),
                E.bindTo('symbol'),
                E.bind('resolver', ({ symbol }) => factory(symbol)),
                E.map(({ symbol, resolver }) => [symbol, resolver] as const)
            );
        }),
        ROR.collect(STR.Ord)((_k, v) => v),
        ROA.separate,
        E_fromSeparated,
        E.map(makeReadOnlyMap)
    );
}

export function makeInterface(ctx: GlobalScopeContext, name: string, members: ROR.ReadonlyRecord<string, PropResolverFactory>) {
    pipe(
        ctx.declMap.get(name),
        E.fromNullable(`could not find ${name} declarations`),
        E.map(ROA.filterMap(O.fromPredicate(tsm.Node.isInterfaceDeclaration))),
        E.chain(flow(ROA.head, E.fromOption(() => `could not find ${name} interface`))),
        E.mapLeft(ROA.of),
        E.bindTo('decl'),
        E.bind('properties', ({ decl }) => makePropertyMap(decl.getType(), members)),
        E.match(
            errors => errors.forEach(error => ctx.addError(error)),
            ({ decl, properties }) => ctx.addType({ type: decl.getType(), properties })
        )
    );
}

export function makeObject(ctx: GlobalScopeContext, name: string, members: ROR.ReadonlyRecord<string, PropResolverFactory>) {
    pipe(
        name,
        getVarDeclAndSymbol(ctx),
        E.mapLeft(ROA.of),
        E.bind('properties', ({ node }) => makePropertyMap(node.getType(), members)),
        E.match(
            errors => errors.forEach(error => ctx.addError(error)),
            ({ node, symbol, properties }) => {
                const map = new Map([...properties].map(([k, v]) => [k.getName(), v]));
                return ctx.addObject({ node, symbol, loadOps: [], properties: map });
            }
        )
    );
}


export function makeMethod(call: CallInvokeResolver): PropResolverFactory {
    return symbol => {
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

export function makeStaticMethod(call: CallInvokeResolver, callNew?: NewInvokeResolver): PropResolverFactory {
    return symbol => {
        return pipe(
            symbol,
            TS.getMethodSig,
            O.map(node => {
                const resolver: PropertyResolver = () => {
                    return E.of(<CompileTimeObject>{ node: node, loadOps: ROA.empty, call, callNew })
                }
                return resolver;
            }),
            E.fromOption(() => `could not find ${symbol.getName()} member`)
        );
    }
}

export function makeProperty(ops: readonly Operation[]): PropResolverFactory {
    return symbol => {
        return pipe(
            symbol,
            TS.getPropSig,
            O.map(node => {
                const resolver: PropertyResolver = ($this) => pipe(
                    $this(),
                    E.map(ROA.concat(ops)),
                    E.map(loadOps => <CompileTimeObject>{ node: node, loadOps, resolver })
                )
                return resolver;
            }),
            E.fromOption(() => `could not find ${symbol.getName()} member`)
        );
    }
}


export function makeStaticProperty(ops: readonly Operation[]): PropResolverFactory {
    return symbol => {
        return pipe(
            symbol,
            TS.getPropSig,
            O.map(node => {
                const resolver: PropertyResolver = () => pipe(
                    ops,
                    E.of,
                    E.map(loadOps => <CompileTimeObject>{ node: node, loadOps, resolver })
                )
                return resolver;
            }),
            E.fromOption(() => `could not find ${symbol.getName()} member`)
        );
    }
}

export function makeCallableObject(ctx: GlobalScopeContext, name: string, callNew?: NewInvokeResolver, call?: CallInvokeResolver) {
    if (!call && !callNew) throw new Error("must provide either call or callNew");
    pipe(
        name,
        getVarDeclAndSymbol(ctx),
        E.map(({ node, symbol }) => {
            return <CompileTimeObject>{ node, symbol, loadOps: [], call, callNew };
        }),
        E.match(
            () => ctx.addError(createDiagnostic("could not find Error declaration")),
            ctx.addObject
        )
    )
}

export function getIsValidOps(count: number) {
    return ROA.fromArray<Operation>([
        { kind: 'duplicate' },
        { kind: 'isnull' },
        { kind: 'jumpif', offset: 5 }, // if null, jump to throw
        { kind: 'duplicate' },
        { kind: 'size' },
        pushInt(count),
        { kind: 'jumpeq', offset: 2 },
        { kind: 'throw' }
    ]);
}

export const callNoOp: CallInvokeResolver = (node) => ($this) =>  pipe($this(), E.map(loadOps => <CompileTimeObject>{ node, loadOps }));
