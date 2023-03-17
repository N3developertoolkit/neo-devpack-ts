import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as O from 'fp-ts/Option';
import { CallableSymbolDef, ParseArgumentsFunc, SymbolDef } from "../types/ScopeType";
import { Operation } from "../types/Operation";
import { $SymbolDef } from "../symbolDef";

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

export class PropertyDef extends $SymbolDef {
    constructor(
        readonly sig: tsm.PropertySignature,
        readonly loadOps: readonly Operation[]
    ) {
        super(sig);
    }
}

export function parseProps(decl: tsm.InterfaceDeclaration) {
    return (props: Record<string, ReadonlyArray<Operation>>): readonly SymbolDef[] => {

        return pipe(
            props,
            ROR.mapWithIndex((key, value) => {
                return pipe(
                    decl.getProperty(key),
                    E.fromNullable(key),
                    E.map(sig => new PropertyDef(sig, value))
                );
            }),
            rorValues,
            checkErrors(`unresolved ${decl.getSymbol()?.getName()} properties`)

        );
    };
}

export class MethodDef extends $SymbolDef implements CallableSymbolDef {
    readonly loadOps = [];
    readonly props = [];
    constructor(
        readonly sig: tsm.MethodSignature,
        readonly parseArguments: ParseArgumentsFunc
    ) {
        super(sig);
    }
}

export function parseMethods(decl: tsm.InterfaceDeclaration) {
    return (methods: Record<string, ParseArgumentsFunc>): readonly SymbolDef[] => {
        return pipe(
            methods,
            ROR.mapWithIndex((key, value) => pipe(
                decl.getMethod(key),
                O.fromNullable,
                O.map(sig => new MethodDef(sig, value)),
                E.fromOption(() => key)
            )),
            rorValues,
            checkErrors(`unresolved ${decl.getSymbol()?.getName()} methods`)
        );
    };
}
