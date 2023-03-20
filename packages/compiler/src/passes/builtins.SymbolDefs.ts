import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as TS from "../utility/TS";
import { CallableSymbolDef, ObjectSymbolDef, ParseArgumentsFunc, SymbolDef } from "../types/ScopeType";
import { Operation } from "../types/Operation";
import { $SymbolDef } from "../symbolDef";
import { parseArguments } from "./expressionProcessor";


export function checkErrors(errorMessage: string) {
    return <T>(results: readonly E.Either<string, T>[]): readonly T[] => {
        const { left: errors, right: values } = pipe(results, ROA.separate);
        if (errors.length > 0)
            throw new Error(`${errorMessage}: ${errors.join()}`);

        return values;
    };
}

export function rorValues<K extends string, A>(r: Readonly<Record<K, A>>) {
    return pipe(r, ROR.toEntries, ROA.map(t => t[1]));
}

export class BuiltInSymbolDef extends $SymbolDef {
    constructor(
        node: tsm.Node,
        readonly loadOps: readonly Operation[]
    ) {
        super(node);
    }
}

export function createBuiltInSymbol(node: tsm.Node, loadOps?: readonly Operation[]) {
    return new BuiltInSymbolDef(
        node,
        loadOps ?? []);
}

export function parseBuiltInSymbols(decl: TS.MemberedNode) {
    return (props: Record<string, ReadonlyArray<Operation>>): readonly SymbolDef[] => {

        return pipe(
            props,
            ROR.mapWithIndex((key, value) => {
                return pipe(
                    decl,
                    TS.getMember(key),
                    E.fromOption(() => key),
                    E.map(sig => createBuiltInSymbol(sig, value))
                );
            }),
            rorValues,
            checkErrors(`unresolved ${decl.getSymbol()?.getName()} properties`)
        );
    };
}

export class BuiltInObjectDef extends $SymbolDef implements ObjectSymbolDef {

    constructor(
        node: tsm.Node,
        readonly loadOps: readonly Operation[],
        readonly props: readonly SymbolDef[],
    ) {
        super(node);
    }
}

export interface BuiltInObjectOptions {
    readonly loadOps?: readonly Operation[],
    readonly props?: readonly SymbolDef[],
}

export function createBuiltInObject(node: tsm.Node, options: BuiltInObjectOptions) {
    return new BuiltInObjectDef(
        node,
        options.loadOps ?? [],
        options.props ?? []);
}

export class BuiltInCallableDef extends $SymbolDef implements CallableSymbolDef {

    constructor(
        node: tsm.Node,
        readonly loadOps: readonly Operation[],
        readonly props: readonly SymbolDef[],
        readonly parseArguments: ParseArgumentsFunc,
    ) {
        super(node);
    }
}

export interface BuiltInCallableOptions extends BuiltInObjectOptions {
    readonly parseArguments?: ParseArgumentsFunc;
}

export function createBuiltInCallable(node: tsm.Node, options: BuiltInCallableOptions) {
    return new BuiltInCallableDef(
        node,
        options.loadOps ?? [],
        options.props ?? [],
        options.parseArguments ?? parseArguments);
}


export function parseBuiltInCallables(decl: TS.MemberedNode) {
    return (props: Record<string, BuiltInCallableOptions>): readonly SymbolDef[] => {

        return pipe(
            props,
            ROR.mapWithIndex((key, value) => {
                return pipe(
                    decl,
                    TS.getMember(key),
                    E.fromOption(() => key),
                    E.map(sig => createBuiltInCallable(sig, value))
                );
            }),
            rorValues,
            checkErrors(`unresolved ${decl.getSymbol()?.getName()} functions`)
        );
    };
}