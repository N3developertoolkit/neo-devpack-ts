import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as TS from "../TS";
import { ParseCallArgsFunc, CompileTimeObject, makeCompileTimeObject } from "../types/CompileTimeObject";
import { Operation } from "../types/Operation";
import { CompileError } from "../utils";
import { parseArguments, parseCallExpression } from "./parseDeclarations";


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

export function createBuiltInSymbol(node: tsm.Node, loadOps?: readonly Operation[]) {
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError('symbol not found', node);

    return makeCompileTimeObject(node, symbol, { loadOps: loadOps ?? [] });
}

export function parseBuiltInSymbols(decl: TS.MemberedNode) {
    return (props: Record<string, ReadonlyArray<Operation>>): readonly CompileTimeObject[] => {

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

export interface BuiltInObjectOptions {
    readonly loadOps?: readonly Operation[],
    readonly props?: readonly CompileTimeObject[],
}

export function createBuiltInObject(node: tsm.Node, options: BuiltInObjectOptions) {
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError('symbol not found', node);

    return makeCompileTimeObject(node, symbol, {
        loadOps: options.loadOps ?? [],
        getProperty: options.props ?? []
    });
}


export interface BuiltInCallableOptions extends BuiltInObjectOptions {
    readonly parseArguments?: ParseCallArgsFunc;
}

export function createBuiltInCallable(node: tsm.Node, options: BuiltInCallableOptions) {
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError('symbol not found', node);

    return makeCompileTimeObject(node, symbol, {
        loadOps: options.loadOps ?? [],
        getProperty: options.props ?? [],
        parseCall: options.parseArguments ?? parseCallExpression
    });
}

export function parseBuiltInCallables(decl: TS.MemberedNode) {
    return (props: Record<string, BuiltInCallableOptions>): readonly CompileTimeObject[] => {

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