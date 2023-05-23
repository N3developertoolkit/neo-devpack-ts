import * as tsm from "ts-morph";

import { CompileTimeObject } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { ParseError } from "../utils";

export interface GlobalScopeContext {
    readonly decls: readonly LibraryDeclaration[]
    readonly declMap: ReadonlyMap<string, readonly LibraryDeclaration[]>;

    addObject(obj: CompileTimeObject): void;
    addType(obj: CompileTimeObject): void;
    addError(error: tsm.ts.Diagnostic): void;
}