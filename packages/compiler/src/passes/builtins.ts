import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord'
import * as O from 'fp-ts/Option'
import * as TS from "../TS";

import { CompilerState } from "../types/CompileOptions";
import { createEmptyScope, createScope } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { makeParseError } from "../symbolDef";
import { createDiagnostic, isVoidLike, single } from "../utils";
import { Operation, parseOperation as $parseOperation, pushString } from "../types/Operation";

import { parseExpression } from "./expressionProcessor";
import { makeByteStringConstructor, makeByteStringInterface } from "./builtins.ByteString";
import { checkErrors, createBuiltInCallable, createBuiltInObject, createBuiltInSymbol, rorValues } from "./builtins.SymbolDefs";
import { makeReadonlyStorageContext, makeStorageConstructor, makeStorageContext } from "./builtins.Storage";
import { LibraryDeclaration } from "../types/LibraryDeclaration";


module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

function sigToSymbolDef(sig: tsm.MethodSignature | tsm.PropertySignature, loadOps: readonly Operation[]) {
    return tsm.Node.isMethodSignature(sig)
        ? createBuiltInCallable(sig, { loadOps })
        : createBuiltInSymbol(sig, loadOps);
}

function makeSysCallInterface(decl: tsm.InterfaceDeclaration) {

    const props = pipe(
        decl.getType().getProperties(),
        ROA.chain(s => s.getDeclarations()),
        ROA.filter(TS.isMethodOrProp),
        ROA.map(member => {
            const name = pipe(
                member,
                TS.getTagComment('syscall'),
                O.toUndefined
            )
            if (!name) {
                throw new Error(`${decl.getSymbol()?.getName()} invalid syscall jsdoc tag`)
            }
            const loadOps = [{ kind: "syscall", name } as Operation];

            return sigToSymbolDef(member, loadOps);
        }),
    );
    return createBuiltInObject(decl, { props })
}








const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\}/;
function makeNativeContractTypeDef(decl: tsm.VariableDeclaration) {
    const hash = pipe(
        decl.getVariableStatement(),
        O.fromNullable,
        O.chain(TS.getTagComment("nativeContract")),
        O.chain(REGEX.match(regexMethodToken)),
        O.chain(ROA.lookup(1)),
        O.map(v => u.HexString.fromHex(v, true)),
        O.toUndefined,
    )

    if (!hash) {
        throw new Error(`invalid hash for ${decl.getSymbol()?.getName()} native contract declaration`);
    }

    const props = pipe(
        decl.getType().getProperties(),
        ROA.chain(s => s.getDeclarations()),
        ROA.filter(TS.isMethodOrProp),
        ROA.map(member => {
            const method = pipe(
                member,
                TS.getTagComment("nativeContract"),
                O.getOrElse(() => member.getSymbolOrThrow().getName())
            );
            const [parametersCount, returnType] = tsm.Node.isPropertySignature(member)
                ? [0, member.getType()]
                : [member.getParameters().length, member.getReturnType()];
            const token = new sc.MethodToken({
                hash: hash.toString(),
                method,
                parametersCount: parametersCount,
                hasReturnValue: !isVoidLike(returnType),
                callFlags: sc.CallFlags.All
            })
            const loadOps = [{ kind: "calltoken", token } as Operation];
            return sigToSymbolDef(member, loadOps);
        })
    );

    const typeDecl = pipe(
        decl.getType().getSymbol(),
        O.fromNullable,
        ROA.fromOption,
        ROA.chain(s => s.getDeclarations()),
        ROA.head,
        O.toUndefined
    );
    if (!typeDecl) throw new Error(`${decl.getName()} invalid type decl`)
    return createBuiltInObject(typeDecl, { props })
}


const parseArgArray = (scope: Scope) => (args: readonly tsm.Expression[]) => {
    return pipe(
        args,
        ROA.map(parseExpression(scope)),
        ROA.sequence(E.Applicative),
        E.map(ROA.reverse),
        E.map(ROA.flatten),
    );
}

export const invokeCallContract =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                TS.getArguments,
                args => {
                    const callArgs = args.slice(0, 3);
                    if (callArgs.length !== 3) return E.left(makeParseError(node)("invalid arg count"));
                    return E.of({
                        callArgs,
                        targetArgs: args.slice(3)
                    })
                },
                E.chain(({ callArgs, targetArgs }) => {
                    return pipe(
                        targetArgs,
                        parseArgArray(scope),
                        E.map(ROA.concat([
                            { kind: "pushint", value: BigInt(targetArgs.length) },
                            { kind: 'packarray' },
                        ] as readonly Operation[])),
                        E.bindTo("target"),
                        E.bind('call', () => pipe(
                            callArgs,
                            parseArgArray(scope),
                            E.map(ROA.append({ kind: "syscall", name: "System.Contract.Call" } as Operation))
                        )),
                        E.map(({ call, target }) => ROA.concat(call)(target))
                    );
                })
            );
        }

export const invokeError =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
            const args = TS.getArguments(node);
            return args.length === 0
                ? E.right([{ kind: 'pushdata', value: Buffer.from("", "utf8") }])
                : parseExpression(scope)(args[0]);
        }

function makeSysCallFunction(decl: tsm.FunctionDeclaration) {
    const serviceName = pipe(decl, TS.getTagComment('syscall'), O.toUndefined);
    if (!serviceName) throw new Error(`Invalid @syscall function ${decl.getSymbol()?.getName()}`)
    const loadOps = [{ kind: "syscall", name: serviceName } as Operation];
    return createBuiltInCallable(decl, { loadOps });
}

function makeStackItemObject(decl: tsm.InterfaceDeclaration) {
    const props = pipe(
        decl.getMembers(),
        ROA.mapWithIndex((index, member) => pipe(
            member,
            E.fromPredicate(tsm.Node.isPropertySignature, () => member.getSymbol()?.getName() ?? "<unknown>"),
            E.map(node => createBuiltInSymbol(node, [
                { kind: 'pushint', value: BigInt(index) },
                { kind: 'pickitem' }
            ]))
        )),
        checkErrors(`invalid @stackitem interface ${decl.getSymbol()?.getName()}`)
    )
    return createBuiltInObject(decl, { props });
}

const regexOperation = /(\S+)\s?(\S+)?/
const parseOperation =
    (comment: string): E.Either<string, Operation> => {
        const matches = comment.match(regexOperation) ?? [];
        return matches.length === 3
            ? pipe(
                $parseOperation(matches[1], matches[2]),
                E.fromNullable(comment)
            )
            : E.left(comment);
    }

function makeOperationsFunction(decl: tsm.FunctionDeclaration) {
    const loadOps = pipe(
        decl.getJsDocs(),
        ROA.chain(d => d.getTags()),
        ROA.filter(t => t.getTagName() === 'operation'),
        ROA.map(t => t.getCommentText() ?? ""),
        ROA.map(parseOperation),
        checkErrors(`invalid @operation function ${decl.getSymbol()?.getName()}`)
    )

    // like standard parseArguments in ExpressionProcessor.ts, but without the argument reverse
    // Right now (nep11 spike) there is only one @operation function (concat). It probably makes 
    // sense to move this to ByteArrayInstance instead of a free function
    const parseArguments =
        (scope: Scope) =>
            (node: tsm.CallExpression) => {
                return pipe(
                    node,
                    TS.getArguments,
                    ROA.map(parseExpression(scope)),
                    ROA.sequence(E.Applicative),
                    E.map(ROA.flatten),
                );
            }

    return createBuiltInCallable(decl, { loadOps, parseArguments });
}

function makeEnumObject(decl: tsm.EnumDeclaration) {
    const props = pipe(
        decl.getMembers(),
        ROA.map(member => {
            const value = member.getValue();
            if (value == undefined) return E.left(member.getName());
            const op: Operation = typeof value === 'number'
                ? { kind: "pushint", value: BigInt(value) }
                : pushString(value);
            return E.of(createBuiltInSymbol(member, [op]))
        }),
        checkErrors(`invalid EnumDeclaration ${decl.getSymbol()?.getName()}`)
    )
    return createBuiltInObject(decl, { props });
}

function makeIteratorInterface(decl: tsm.InterfaceDeclaration): SymbolDef {
    return createBuiltInSymbol(decl);
}

const isFunctionDeclaration = O.fromPredicate(tsm.Node.isFunctionDeclaration);
const isInterfaceDeclaration = O.fromPredicate(tsm.Node.isInterfaceDeclaration);
const isVariableStatement = O.fromPredicate(tsm.Node.isVariableStatement);
const isEnumDeclaration = O.fromPredicate(tsm.Node.isEnumDeclaration);

export const makeGlobalScope =
    (decls: readonly LibraryDeclaration[]): CompilerState<Scope> =>
        diagnostics => {

            const enums = pipe(decls, ROA.filterMap(isEnumDeclaration));
            const functions = pipe(decls, ROA.filterMap(isFunctionDeclaration));
            const interfaces = pipe(decls, ROA.filterMap(isInterfaceDeclaration));
            const varStatements = pipe(decls, ROA.filterMap(isVariableStatement));
            const variables = pipe(varStatements, ROA.chain(s => s.getDeclarations()));

            let typeDefs: ReadonlyArray<SymbolDef> = [];
            let symbolDefs: ReadonlyArray<SymbolDef> = [];

            typeDefs = pipe(
                interfaces,
                ROA.filter(TS.hasTag("stackitem")),
                ROA.map(makeStackItemObject),
                ROA.concat(typeDefs)
            )

            typeDefs = pipe(
                varStatements,
                ROA.filter(TS.hasTag('nativeContract')),
                ROA.chain(s => s.getDeclarations()),
                ROA.map(makeNativeContractTypeDef),
                ROA.concat(typeDefs)
            )

            symbolDefs = pipe(
                varStatements,
                ROA.filter(TS.hasTag('nativeContract')),
                ROA.chain(s => s.getDeclarations()),
                ROA.map(createBuiltInSymbol),
                ROA.concat(symbolDefs)
            )

            symbolDefs = pipe(
                functions,
                ROA.filter(TS.hasTag('syscall')),
                ROA.map(makeSysCallFunction),
                ROA.concat(symbolDefs)
            )

            symbolDefs = pipe(
                functions,
                ROA.filter(TS.hasTag('operation')),
                ROA.map(makeOperationsFunction),
                ROA.concat(symbolDefs)
            )

            const builtInEnums: Record<string, (decl: tsm.EnumDeclaration) => SymbolDef> = {
                "CallFlags": makeEnumObject,
                "FindOptions": makeEnumObject,
            }

            const builtInFunctions: Record<string, (decl: tsm.FunctionDeclaration) => SymbolDef> = {
                "callContract": decl => createBuiltInCallable(decl, { parseArguments: invokeCallContract }),
            }

            const builtInInterfaces: Record<string, (decl: tsm.InterfaceDeclaration) => SymbolDef> = {
                "ByteStringConstructor": makeByteStringConstructor,
                "ByteString": makeByteStringInterface,
                "Iterator": makeIteratorInterface,
                "ReadonlyStorageContext": makeReadonlyStorageContext,
                "RuntimeConstructor": makeSysCallInterface,
                "StorageConstructor": makeStorageConstructor,
                "StorageContext": makeStorageContext,
            }

            const builtInVars: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
                "ByteString": createBuiltInSymbol,
                "Error": decl => createBuiltInCallable(decl, { parseArguments: invokeError }),
                "Runtime": createBuiltInSymbol,
                "Storage": createBuiltInSymbol,
            }

            symbolDefs = resolveBuiltins(builtInEnums)(enums)(symbolDefs);
            symbolDefs = resolveBuiltins(builtInFunctions)(functions)(symbolDefs);
            symbolDefs = resolveBuiltins(builtInVars)(variables)(symbolDefs);

            typeDefs = resolveBuiltins(builtInInterfaces)(interfaces)(typeDefs);

            return pipe(
                createScope()(symbolDefs, typeDefs),
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
        }

export type BuiltinDeclaration = tsm.EnumDeclaration | tsm.FunctionDeclaration | tsm.InterfaceDeclaration | tsm.VariableDeclaration;

const resolveBuiltins =
    <T extends BuiltinDeclaration>(map: ROR.ReadonlyRecord<string, (decl: T) => SymbolDef>) =>
        (declarations: readonly T[]) =>
            (symbolDefs: readonly SymbolDef[]) => {
                const defs = pipe(
                    map,
                    ROR.mapWithIndex((key, func) => pipe(
                        declarations,
                        ROA.filter(d => d.getName() === key),
                        single,
                        O.map(func),
                        E.fromOption(() => key),
                    )),
                    rorValues,
                    checkErrors('unresolved built in variables'),
                )
                return ROA.concat(defs)(symbolDefs);
            }