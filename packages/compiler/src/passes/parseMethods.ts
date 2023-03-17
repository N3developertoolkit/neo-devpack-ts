import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as O from 'fp-ts/Option';
import { ParseArgumentsFunc, SymbolDef } from "../types/ScopeType";
import { StaticMethodDef, rorValues, checkErrors } from "./builtins";
import { Operation } from "../types/Operation";
import { PropertyDef } from "./builtins.ByteString";

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
export function parseMethods(decl: tsm.InterfaceDeclaration) {
    return (methods: Record<string, ParseArgumentsFunc>): readonly SymbolDef[] => {
        return pipe(
            methods,
            ROR.mapWithIndex((key, value) => pipe(
                decl.getMethod(key),
                O.fromNullable,
                O.map(sig => new StaticMethodDef(sig, value)),
                E.fromOption(() => key)
            )),
            rorValues,
            checkErrors(`unresolved ${decl.getSymbol()?.getName()} methods`)
        );
    };
}
