import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap';
import * as S from 'fp-ts/State';
import * as TS from "../TS";

import { CompileTimeObject, CompileTimeType, InvokeResolver, PropertyResolver, Scope, createEmptyScope, createScope } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { GlobalScopeContext, makeInvokeResolver, parseArguments, parseSymbol } from "./types";
import { createDiagnostic, isVoidLike, makeParseDiagnostic } from "../utils";
import { makePropResolvers, parseEnumDecl } from "../passes/parseDeclarations";
import { Operation, parseOperation, pushInt } from "../types/Operation";
import { makeCallContract } from "./callContract";
import { makeRuntime } from "./runtime";
import { makeStorage } from "./storage";
import { sc, u } from "@cityofzion/neon-core";
import { makeByteString } from "./bytestring";

module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

function makeEnums(ctx: GlobalScopeContext): void {
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
    const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\}/;

    const { left: errors, right: objects } = pipe(
        ctx.decls,
        ROA.filterMap(O.fromPredicate(tsm.Node.isVariableDeclaration)),
        ROA.filter($var => pipe(
            $var.getVariableStatement(),
            O.fromNullable,
            O.map(TS.hasTag("nativeContract")),
            O.getOrElse(() => false)
        )),
        ROA.map(makeNativeContract),
        ROA.separate
    )
    errors.forEach(ctx.addError);
    objects.forEach(ctx.addObject);

    function makeNativeContract(node: tsm.VariableDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeObject> {
        return pipe(
            E.Do,
            E.bind("symbol", () => pipe(
                node,
                TS.parseSymbol,
                E.mapLeft(makeParseDiagnostic)
            )),
            E.bind('hash', () => pipe(
                node.getVariableStatement(),
                O.fromNullable,
                O.chain(TS.getTagComment("nativeContract")),
                O.chain(REGEX.match(regexMethodToken)),
                O.chain(ROA.lookup(1)),
                O.map(v => u.HexString.fromHex(v, true)),
                E.fromOption(() => createDiagnostic(`Invalid @nativeContract tag for ${node.getName()}`, { node }))
            )),
            E.bind('props', ({ hash }) => pipe(
                node.getType().getProperties(),
                ROA.map(makeNativeContractMember(hash)),
                ROA.sequence(E.Applicative)
            )),
            E.map(({ symbol, props }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties: makePropResolvers(props) })
        );
    }

    function makeNativeContractMember(hash: u.HexString) {
        return (symbol: tsm.Symbol): E.Either<tsm.ts.Diagnostic, CompileTimeObject> => {
            return pipe(
                symbol.getValueDeclaration(),
                O.fromNullable,
                O.chain(O.fromPredicate(TS.isMethodOrProp)),
                E.fromOption(() => createDiagnostic(`could not find value declaration for ${symbol.getName()}`)),
                E.map(node => {
                    const method = pipe(
                        node,
                        TS.getTagComment('nativeContract'),
                        O.getOrElse(() => symbol.getName())
                    );
                    if (tsm.Node.isPropertySignature(node)) {
                        const token = new sc.MethodToken({
                            hash: hash.toString(),
                            method,
                            parametersCount: 0,
                            hasReturnValue: !isVoidLike(node.getType()),
                            callFlags: sc.CallFlags.All
                        })
                        return <CompileTimeObject>{ node, symbol, loadOps: [{ kind: 'calltoken', token }] };
                    } else {
                        // token.parametersCount field is dependent on the number of arguments,
                        // so can't use makeInvokeResolver here
                        const resolver: InvokeResolver = ($this, args) => {
                            const token = new sc.MethodToken({
                                hash: hash.toString(),
                                method,
                                parametersCount: args.length,
                                hasReturnValue: !isVoidLike(node.getReturnType()),
                                callFlags: sc.CallFlags.All
                            })
                            return pipe(
                                args,
                                parseArguments,
                                E.map(ROA.append<Operation>({ kind: 'calltoken', token })),
                                E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                            );
                        }
                        return <CompileTimeObject>{ node, symbol, loadOps: [], call: () => resolver };
                    }
                })
            )
        }
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
            E.map(({ symbol, operations }) => <CompileTimeObject>{ node, symbol, loadOps: [] }),
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
            E.map(({ symbol, serviceName }) => {
                const op = <Operation>{ kind: 'syscall', name: serviceName };
                const resolver = makeInvokeResolver(node, op);
                return <CompileTimeObject>{ node, symbol, loadOps: [], call: () => resolver };
            }),
        );
    }
}

function makeStackItems(ctx: GlobalScopeContext) {
    const { left: errors, right: types } = pipe(
        ctx.decls,
        ROA.filterMap(O.fromPredicate(tsm.Node.isInterfaceDeclaration)),
        ROA.filter(TS.hasTag("stackitem")),
        ROA.map(makeStackItemType),
        ROA.separate
    )
    errors.forEach(ctx.addError);
    types.forEach(ctx.addType);

    function makeStackItemType(node: tsm.InterfaceDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeType>  {
        const type = node.getType();
        return pipe(
            type.getProperties(),
            ROA.mapWithIndex((index, symbol) => pipe(
                symbol.getValueDeclaration(),
                E.fromPredicate(
                    tsm.Node.isPropertySignature,
                    () => createDiagnostic(`could not get value declaration for ${node.getName()}.${symbol.getName()}`, { node })
                ),
                E.map(node => {
                    const loadOps: readonly Operation[] = [pushInt(index), { kind: 'pickitem' }];
                    return <CompileTimeObject>{ node, symbol, loadOps };
                })
            )), 
            ROA.sequence(E.Applicative),
            E.map(props => {
                const properties = pipe(
                    props,
                    ROA.map(cto => {
                        const resolver: PropertyResolver = ($this) => pipe(
                            $this(),
                            E.map(ROA.concat(cto.loadOps)),
                            E.map(loadOps => <CompileTimeObject>{ ...cto, loadOps })
                        );
                        return [cto.symbol, resolver] as const;
                    }),
                    props => new Map(props),
                    ROM.fromMap,
                )
                return <CompileTimeType>{ type, properties }
            })
        )
    }
}

const makerFunctions = [
    // metadata driven built ins
    makeEnums,
    makeNativeContracts,
    // makeOperationFunctions,
    makeStackItems,
    makeSyscallFunctions,
    // // explicit built ins
    makeByteString,
    makeCallContract,
    // makeError,
    makeRuntime,
    makeStorage
]

export function makeGlobalScope(decls: readonly LibraryDeclaration[]): S.State<readonly tsm.ts.Diagnostic[], Scope> {
    return diagnostics => {
        const errors: tsm.ts.Diagnostic[] = [];
        const objects: CompileTimeObject[] = [];
        const types: CompileTimeType[] = [];

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
            addType: (type: CompileTimeType) => { types.push(type); }
        }

        makerFunctions.forEach(maker => maker(context));
        return errors.length > 0
            ? [createEmptyScope(), ROA.concat(errors)(diagnostics)]
            : [createScope(undefined)(objects, types), diagnostics];
    };
}