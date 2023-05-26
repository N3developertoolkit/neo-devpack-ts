import * as tsm from "ts-morph";

import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TS from "../TS";
import * as ROA from 'fp-ts/ReadonlyArray';

import { CompileTimeObject, GetOpsFunc, InvokeResolver } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { ParseError, createDiagnostic, isArray } from "../utils";
import { Operation } from "../types/Operation";

export interface GlobalScopeContext {
    readonly decls: readonly LibraryDeclaration[]
    readonly declMap: ReadonlyMap<string, readonly LibraryDeclaration[]>;

    addObject(obj: CompileTimeObject): void;
    // addType(obj: CompileTimeObject): void;
    addError(error: tsm.ts.Diagnostic): void;
}

export function parseSymbol(node: LibraryDeclaration) {
    return pipe(
        node,
        TS.getSymbol,
        E.fromOption(() => createDiagnostic(`could not get ${node.getName()} symbol`, { node }))
    );
}

export function parseTypeSymbol(node: LibraryDeclaration) {
    return pipe(
        node.getType(),
        TS.getTypeSymbol,
        E.fromOption(() => createDiagnostic(`could not get ${node.getName()} type symbol`, { node }))
    );
}

export function parseArguments(args: readonly GetOpsFunc[]): E.Either<ParseError, readonly Operation[]> {
    return pipe(
        args,
        ROA.reverse,
        ROA.map(arg => arg()),
        ROA.sequence(E.Applicative),
        E.map(ROA.flatten),
    )
}

export function makeInvokeResolver(node: tsm.Node, ops: Operation | readonly Operation[], implicitThis: boolean = false) : InvokeResolver {
    return ($this, args) => {
        const $args = implicitThis ? ROA.prepend($this)(args) : args;
        return pipe(
            $args,
            parseArguments,
            E.map(ROA.concat(isArray(ops) ? ops : [ops])),
            E.map(loadOps => (<CompileTimeObject>{
                node: node,
                symbol: node.getSymbolOrThrow(),
                loadOps
            }))
        );
    }
}