import * as tsm from "ts-morph";

import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TS from "../TS";

import { CompileTimeObject } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { createDiagnostic } from "../utils";

export interface GlobalScopeContext {
    readonly decls: readonly LibraryDeclaration[]
    readonly declMap: ReadonlyMap<string, readonly LibraryDeclaration[]>;

    addObject(obj: CompileTimeObject): void;
    addType(obj: CompileTimeObject): void;
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