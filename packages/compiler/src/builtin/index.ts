import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State';
import * as TS from "../TS";

import { CompileTimeObject, CompileTimeType, InvokeResolver, PropertyResolver, Scope, createEmptyScope, createScope, parseArguments } from "../types/CompileTimeObject";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { GlobalScopeContext } from "./common";
import { createDiagnostic, isVoidLike, makeParseDiagnostic, makeParseError, makeReadOnlyMap } from "../utils";
import { Operation, pushInt, pushString } from "../types/Operation";
import { makeFunctions } from "./functions";
import { makeRuntime } from "./runtime";
import { makeStorage } from "./storage";
import { sc, u } from "@cityofzion/neon-core";
import { makeByteString } from "./bytestring";
import { makeError } from "./error";
import { makeMap } from "./map";
import { makeHashTypes } from "./hashTypes";

module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

function makeEnums(ctx: GlobalScopeContext): void {
    // std TS lib does not define any enums
    // convert all neo enum declarations to objects
    const { left: errors, right: objects } = pipe(
        ctx.decls,
        ROA.filterMap(O.fromPredicate(tsm.Node.isEnumDeclaration)),
        ROA.map(makeEnum),
        ROA.separate
    );
    errors.forEach(ctx.addError);
    objects.forEach(ctx.addObject);

    function makeEnum(node: tsm.EnumDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeObject> {
        if (!node.isConstEnum()) return E.left(createDiagnostic("enum must be const", { node }));
        return pipe(
            node.getMembers(),
            ROA.map(member => {
                return pipe(
                    E.Do,
                    E.bind('symbol', () => pipe(member, TS.parseSymbol)),
                    E.bind('op', () => pipe(
                        member, 
                        TS.getEnumValue, 
                        E.map(value => typeof value === 'number' ? pushInt(value) : pushString(value)),
                        E.mapLeft(makeParseError(member))
                    )),
                    E.map(({ op, symbol }) => {
                        const resolver: PropertyResolver = () => E.of(<CompileTimeObject>{ node: member, symbol, loadOps: [op] });
                        return [symbol.getName(), resolver] as const;
                    })
                )
            }),
            ROA.sequence(E.Applicative),
            E.map(makeReadOnlyMap),
            E.map(properties => <CompileTimeObject>{ node, loadOps: [], properties }),
            E.mapLeft(makeParseDiagnostic)
        )
    }
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
            E.bind('properties', ({ hash }) => pipe(
                node.getType().getProperties(),
                ROA.map(makeNativeContractMember(hash)),
                ROA.sequence(E.Applicative),
                E.map(makeReadOnlyMap)
            )),
            E.map(({ symbol, properties }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties })
        );
    }

    function makeNativeContractMember(hash: u.HexString) {
        return (symbol: tsm.Symbol): E.Either<tsm.ts.Diagnostic, readonly [string, PropertyResolver]> => {
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
                        const paramCount = node.getParameters().length;
                        const resolver: InvokeResolver = ($this, args) => {
                            const token = new sc.MethodToken({
                                hash: hash.toString(),
                                method,
                                parametersCount: paramCount,
                                hasReturnValue: !isVoidLike(node.getReturnType()),
                                callFlags: sc.CallFlags.All
                            })
                            return pipe(
                                args,
                                parseArguments(paramCount),
                                E.map(ROA.append<Operation>({ kind: 'calltoken', token })),
                                E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                            );
                        }
                        return <CompileTimeObject>{ node, symbol, loadOps: [], call: () => resolver };
                    }
                }),
                E.map(cto => [symbol.getName(), () => E.of(cto)] as const)
            )
        }
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

    function makeStackItemType(node: tsm.InterfaceDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeType> {
        const type = node.getType();
        return pipe(
            type.getProperties(),
            ROA.mapWithIndex((index, symbol) => pipe(
                symbol.getValueDeclaration(),
                E.fromPredicate(
                    tsm.Node.isPropertySignature,
                    () => `could not get value declaration for ${node.getName()}.${symbol.getName()}`
                ),
                E.map(node => {
                    const resolver: PropertyResolver = ($this) => pipe(
                        $this(),
                        E.map(ROA.concat<Operation>([pushInt(index), { kind: 'pickitem' }])),
                        E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                    );
                    return [symbol, resolver] as const;
                })
            )),
            ROA.sequence(E.Applicative),
            E.mapLeft(msg => createDiagnostic(msg, { node })),
            E.map(makeReadOnlyMap),
            E.map(properties => <CompileTimeType>{ type, properties })
        )
    }
}

const makerFunctions = [
    makeByteString,
    makeEnums,
    makeError,
    makeFunctions,
    makeHashTypes,
    makeMap,
    makeNativeContracts,
    makeRuntime,
    makeStackItems,
    makeStorage,
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
            addError: (error: string | tsm.ts.Diagnostic) => {
                error = typeof error === 'string' ? createDiagnostic(error) : error;
                errors.push(error);
            },
            addObject: (obj: CompileTimeObject) => { objects.push(obj); },
            addType: (type: CompileTimeType) => { types.push(type); }
        }

        makerFunctions.forEach(maker => maker(context));
        return errors.length > 0
            ? [createEmptyScope(), ROA.concat(errors)(diagnostics)]
            : [createScope(undefined)(objects, types), diagnostics];
    };
}