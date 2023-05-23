import * as tsm from "ts-morph";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as S from 'fp-ts/State';
import * as TS from "../TS";

import { CompileTimeObject, Scope, createEmptyScope, createScope } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { GlobalScopeContext } from "./types";
import { CompileError, ParseError, createDiagnostic, makeParseDiagnostic } from "../utils";
import { parseEnumDecl } from "../passes/parseDeclarations";

class $GlobalScopeContext implements GlobalScopeContext {
    readonly declMap: ReadonlyMap<string, readonly LibraryDeclaration[]>;
    readonly errors: tsm.ts.Diagnostic[] = [];
    readonly objects: CompileTimeObject[] = [];
    readonly types: CompileTimeObject[] = [];

    constructor(readonly decls: readonly LibraryDeclaration[]) {
        const declMap = new Map<string, readonly LibraryDeclaration[]>();
        for (const d of decls) {
            const name = d.getName();
            if (!name) throw new CompileError("invalid name", d);
            const list = declMap.get(name) ?? [];
            declMap.set(name, ROA.append(d)(list));
        }
        this.declMap = declMap;
    }

    addObject(obj: CompileTimeObject): void {
        this.objects.push(obj);
    }

    addType(obj: CompileTimeObject): void {
        this.types.push(obj);
    }

    addError(error: tsm.ts.Diagnostic | ParseError): void {
        const diag = "message" in error ? makeParseDiagnostic(error) : error;
        this.errors.push(diag);
    }
}

function makeEnumObjects(ctx: GlobalScopeContext): void {
    // std TS lib does not define any enums
    // convert all neo enum declarations to objects
    const { left: errors, right: objects } = pipe(
        ctx.decls,
        ROA.filterMap(O.fromPredicate(tsm.Node.isEnumDeclaration)),
        ROA.map(parseEnumDecl),
        ROA.map(E.mapLeft(makeParseDiagnostic)),
        ROA.separate
    );
    errors.forEach(ctx.addError);
    objects.forEach(ctx.addObject);
}

export function makeGlobalScope2(decls: readonly LibraryDeclaration[]): S.State<readonly tsm.ts.Diagnostic[], Scope> {
    return diagnostics => {
        const errors: tsm.ts.Diagnostic[] = [];
        const objects: CompileTimeObject[] = [];
        const types: CompileTimeObject[] = [];

        const declMap = new Map<string, readonly LibraryDeclaration[]>();
        for (const decl of decls) {
            const name = decl.getName();
            if (name) {
                const list = declMap.get(name) ?? [];
                declMap.set(name, ROA.append(decl)(list));
            } else {
                errors.push(createDiagnostic("invalid name", { node: decl }))
            }
        }

        // if there are any errors creating the decl map, bail out without creating a scope
        if (errors.length > 0) {
            return [createEmptyScope(), ROA.concat(errors)(diagnostics)];
        }

        const context: GlobalScopeContext = { 
            decls, 
            declMap, 
            addError: (error: tsm.ts.Diagnostic) => { errors.push(error); }, 
            addObject: (obj: CompileTimeObject) => { objects.push(obj); }, 
            addType : (obj: CompileTimeObject) => { types.push(obj); }
        }

        makeEnumObjects(context);

        diagnostics = ROA.concat(errors)(diagnostics);
        return pipe(
            createScope()(objects, types),
            E.match(
                error => {
                    diagnostics = ROA.append(createDiagnostic(error))(diagnostics);
                    return [createEmptyScope(), diagnostics];
                },
                scope => {
                    return [scope, diagnostics];
                }
            )
        );
    };
}