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
import { GlobalScopeContext, parseSymbol, parseTypeSymbol } from "./types";
import { CompileError, ParseError, createDiagnostic, makeParseDiagnostic } from "../utils";
import { parseEnumDecl } from "../passes/parseDeclarations";
import { Operation, parseOperation } from "../types/Operation";
import { create } from "domain";
import { makeByteString } from "./bytestring";
import { makeCallContract } from "./callContract";
import { makeRuntime } from "./runtime";
import { makeStorage } from "./storage";
import { makeError } from "./error";



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

function makeNativeContracts(ctx: GlobalScopeContext) {
    {
        const { left: errors, right: objects } = pipe(
            ctx.decls,
            // find all the variable declarations that have the @nativeContract tag
            ROA.filterMap(O.fromPredicate(tsm.Node.isVariableDeclaration)),
            ROA.filter($var => pipe(
                $var.getVariableStatement(),
                O.fromNullable,
                O.map(TS.hasTag("nativeContract")),
                O.getOrElse(() => false)
            )),
            // create a CTO object for each @nativeContract variable 
            ROA.map(node => pipe(
                node,
                parseSymbol,
                // TODO: real CTO
                E.map(symbol => <CompileTimeObject>{ node, symbol }),
            )),
            ROA.separate
        );
        errors.forEach(ctx.addError);
        objects.forEach(ctx.addObject);
    }

    {
        const { left: errors, right: types } = pipe(
            ctx.decls,
            ROA.filterMap(O.fromPredicate(tsm.Node.isInterfaceDeclaration)),
            ROA.filter(TS.hasTag("nativeContract")),
            ROA.map(node => pipe(
                node,
                parseTypeSymbol,
                // TODO: real CTO
                E.map(symbol => <CompileTimeObject>{ node, symbol }),
            )),
            ROA.separate
        );
        errors.forEach(ctx.addError);
        types.forEach(ctx.addType);
    }
}

const regexOperationTagComment = /(\S+)\s?(\S+)?/
function makeOperationFunctions(ctx: GlobalScopeContext) {
    const { left: errors, right: objects } = pipe(
        ctx.decls,
        // find all the function declarations that have the @syscall tag
        ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
        ROA.filter(TS.hasTag("operation")),
        ROA.map(makeFunction),
        ROA.separate
    );
    errors.forEach(ctx.addError);
    objects.forEach(ctx.addObject);

    function makeFunction(node: tsm.FunctionDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeObject> {
        return pipe(
            E.Do,
            E.bind("symbol", () => pipe(node, parseSymbol)),
            // parse the @operations tags into an array of operations
            E.bind("operations", () => pipe(
                node.getJsDocs(),
                ROA.chain(doc => doc.getTags()),
                ROA.filter(tag => tag.getTagName() === 'operation'),
                ROA.map(tag => tag.getCommentText() ?? ""),
                ROA.map(parseOperationTagComment),
                ROA.sequence(E.Applicative),
                E.mapLeft(msg => createDiagnostic(msg, { node }))
            )),
            // TODO: real CTO
            E.map(({ symbol, operations }) => <CompileTimeObject>{ node, symbol }),
        );
    }

    function parseOperationTagComment(comment: string): E.Either<string, Operation> {
        const matches = comment.match(regexOperationTagComment) ?? [];
        return matches.length === 3
            ? pipe(
                parseOperation(matches[1], matches[2]),
                E.fromNullable(comment)
            )
            : E.left(comment);
    }

}

function makeSyscallFunctions(ctx: GlobalScopeContext) {
    const { left: errors, right: objects } = pipe(
        ctx.decls,
        // find all the function declarations that have the @syscall tag
        ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
        ROA.filter(TS.hasTag("syscall")),
        ROA.map(makeFunction),
        ROA.separate
    );
    errors.forEach(ctx.addError);
    objects.forEach(ctx.addObject);

    function makeFunction(node: tsm.FunctionDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeObject> {
        return pipe(
            E.Do,
            E.bind("symbol", () => pipe(node, parseSymbol)),
            E.bind("serviceName", () => pipe(
                node,
                TS.getTagComment('syscall'),
                E.fromOption(() => createDiagnostic(`Invalid @syscall tag for ${node.getName()}`, { node }),
                ))),
            // TODO: real CTO
            E.map(({ symbol, serviceName }) => <CompileTimeObject>{ node, symbol }),
        );
    }
}

function makeStackItemTypes(ctx: GlobalScopeContext) {
    const { left: errors, right: types } = pipe(
        ctx.decls,
        ROA.filterMap(O.fromPredicate(tsm.Node.isInterfaceDeclaration)),
        ROA.filter(TS.hasTag("stackitem")),
        ROA.map(makeStackItemType),
        ROA.separate
    )
    errors.forEach(ctx.addError);
    types.forEach(ctx.addType);

    function makeStackItemType(node: tsm.InterfaceDeclaration) {
        return pipe(
            E.Do,
            E.bind("symbol", () => pipe(node, parseTypeSymbol)),
            // TODO: real CTO
            E.map(({ symbol }) => <CompileTimeObject>{ node, symbol }),
        );
    }
}


const makerFunctions = [
    // metadata driven built ins
    makeEnumObjects,
    makeNativeContracts,
    makeOperationFunctions,
    makeStackItemTypes,
    makeSyscallFunctions,
    // explicit built ins
    makeByteString,
    makeCallContract,
    makeError,
    makeRuntime,
    makeStorage
]




export function makeGlobalScope(decls: readonly LibraryDeclaration[]): S.State<readonly tsm.ts.Diagnostic[], Scope> {
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
            addType: (obj: CompileTimeObject) => { types.push(obj); }
        }

        makerFunctions.forEach(maker => maker(context));

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