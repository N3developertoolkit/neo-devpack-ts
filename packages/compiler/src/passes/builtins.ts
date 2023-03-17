import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord'
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";

import { LibraryDeclarations } from "../projectLib";
import { CompilerState } from "../types/CompileOptions";
import { createScope } from "../scope";
import { CallableSymbolDef, ObjectSymbolDef, ParseArgumentsFunc, ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { $SymbolDef, makeParseError } from "../symbolDef";
import { isVoidLike, single } from "../utils";
import { Operation, parseOperation as $parseOperation } from "../types/Operation";

import { getArguments, parseArguments, parseExpression } from "./expressionProcessor";
import { makeByteStringConstructor, makeByteStringInterface } from "./builtins.ByteString";
import { checkErrors, createBuiltInCallable, createBuiltInObject, createBuiltInSymbol } from "./builtins.SymbolDefs";


export function checkOption<T>(errorMessage: string) {
    return O.match<T, T>(
        () => { throw new Error(errorMessage); },
        identity
    );
}
function getVariableStatement(node: tsm.VariableDeclaration) {
    return O.fromNullable(node.getVariableStatement());
}
function isMethodOrProp(node: tsm.Node): node is (tsm.MethodSignature | tsm.PropertySignature) {
    return tsm.Node.isMethodSignature(node) || tsm.Node.isPropertySignature(node);
}

module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

class StaticClassDef extends $SymbolDef {
    readonly loadOps: ReadonlyArray<Operation> = [];

    constructor(readonly decl: tsm.VariableDeclaration) {
        super(decl);
    }
}

class SysCallInterfaceMemberDef extends $SymbolDef implements ObjectSymbolDef {
    readonly loadOps: readonly Operation[];
    readonly props = [];
    readonly parseArguments?: ParseArgumentsFunc;

    constructor(
        readonly sig: tsm.MethodSignature | tsm.PropertySignature,
        readonly serviceName: string
    ) {
        super(sig);
        this.loadOps = [{ kind: "syscall", name: this.serviceName }]
        if (tsm.Node.isMethodSignature(sig)) {
            this.parseArguments = parseArguments;
        }
    }
}

class SysCallInterfaceDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props: readonly ObjectSymbolDef[];

    constructor(readonly decl: tsm.InterfaceDeclaration) {
        super(decl);
        this.props = pipe(
            this.type.getProperties(),
            ROA.chain(symbol => symbol.getDeclarations()),
            ROA.map(member => pipe(
                member,
                O.fromPredicate(isMethodOrProp),
                O.map(signature => {
                    const name = pipe(
                        signature,
                        TS.getTagComment('syscall'),
                        O.match(() => signature.getSymbolOrThrow().getName(), identity));

                    return new SysCallInterfaceMemberDef(signature, name);
                }),
                E.fromOption(() => member.getSymbolOrThrow().getName())
            )),
            checkErrors("Invalid syscall interface members")
        )
    }
}


class NativeContractMemberDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props = [];
    readonly loadOps: readonly Operation[];
    readonly parseArguments?: ParseArgumentsFunc;

    constructor(
        readonly sig: tsm.MethodSignature | tsm.PropertySignature,
        readonly hash: u.HexString,
        readonly method: string,
    ) {
        super(sig);

        let parametersCount = 0;
        let returnType = sig.getType();
        if (tsm.Node.isMethodSignature(sig)) {
            parametersCount = sig.getParameters().length;
            returnType = sig.getReturnType();
            this.parseArguments = parseArguments
        }
        const token = new sc.MethodToken({
            hash: hash.toString(),
            method: method,
            parametersCount: parametersCount,
            hasReturnValue: !isVoidLike(returnType),
            callFlags: sc.CallFlags.All
        })
        this.loadOps = [
            { kind: 'calltoken', token }
        ]
    }
}

class NativeContractConstructorDef extends $SymbolDef implements ObjectSymbolDef {
    readonly loadOps: ReadonlyArray<Operation> = [];
    readonly props: ReadonlyArray<ObjectSymbolDef>

    constructor(
        readonly hash: u.HexString,
        readonly decl: tsm.InterfaceDeclaration,
    ) {
        super(decl);
        this.props = pipe(
            this.type.getProperties(),
            ROA.chain(symbol => symbol.getDeclarations()),
            ROA.map(member => pipe(
                member,
                O.fromPredicate(isMethodOrProp),
                O.map(signature => {
                    const name = pipe(
                        signature,
                        TS.getTagComment("nativeContract"),
                        O.match(() => signature.getSymbolOrThrow().getName(), identity));

                    return new NativeContractMemberDef(signature, hash, name);
                }),
                E.fromOption(() => member.getSymbolOrThrow().getName())
            )),
            checkErrors("Invalid stack item members")
        )
    }

}




















const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\}/;
function makeNativeContract(decl: tsm.VariableDeclaration) {
    const hash = pipe(
        decl,
        getVariableStatement,
        O.chain(TS.getTagComment("nativeContract")),
        O.chain(REGEX.match(regexMethodToken)),
        O.chain(ROA.lookup(1)),
        O.map(v => u.HexString.fromHex(v, true)),
        O.match(
            () => { throw new Error(`invalid hash for ${decl.getSymbol()?.getName()} native contract declaration`); },
            identity
        )
    )

    const typeDef = pipe(
        decl,
        TS.getType,
        t => O.fromNullable(t.getSymbol()),
        O.map(TS.getSymbolDeclarations),
        O.chain(single),
        O.chain(O.fromPredicate(tsm.Node.isInterfaceDeclaration)),
        O.map(decl => new NativeContractConstructorDef(hash, decl)),
        O.match(
            () => { throw new Error(`invalid declaration for ${decl.getSymbol()?.getName()} native contract`); },
            identity
        )
    );

    return [new StaticClassDef(decl), typeDef]
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
                getArguments,
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
                            { kind: 'pack' },
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
            const args = getArguments(node);
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

    // like standard parseArguments in ExpressionProcessor.ts, but without the argument reverrse
    const parseArguments =
        (scope: Scope) =>
            (node: tsm.CallExpression) => {
                return pipe(
                    node,
                    getArguments,
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
                : { kind: "pushdata", value: Buffer.from(value, 'utf8') };
            return E.of(createBuiltInSymbol(member, [op]))
        }),
        checkErrors(`invalid EnumDeclaration ${decl.getSymbol()?.getName()}`)
    )
    return createBuiltInObject(decl, { props });
}


export const makeGlobalScope =
    (decls: LibraryDeclarations): CompilerState<Scope> =>
        diagnostics => {

            let symbolDefs: ReadonlyArray<SymbolDef> = ROA.empty;

            symbolDefs = pipe(
                decls.interfaces,
                ROA.filter(TS.hasTag("stackitem")),
                ROA.map(makeStackItemObject),
                ROA.concat(symbolDefs)
            )

            // symbolDefs = pipe(
            //     decls.variables,
            //     ROA.filter(flow(
            //         getVariableStatement,
            //         O.map(TS.hasTag('nativeContract')),
            //         O.match(() => false, identity)
            //     )),
            //     ROA.map(NativeContractConstructorDef.makeNativeContract),
            //     ROA.flatten,
            //     ROA.concat(symbolDefs)
            // )

            symbolDefs = pipe(
                decls.functions,
                ROA.filter(TS.hasTag('syscall')),
                ROA.map(makeSysCallFunction),
                ROA.concat(symbolDefs)
            )

            symbolDefs = pipe(
                decls.functions,
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
                "ByteStringInstance": makeByteStringInterface,
                "ReadonlyStorageContext": decl => new SysCallInterfaceDef(decl),
                "RuntimeConstructor": decl => new SysCallInterfaceDef(decl),
                "StorageConstructor": decl => new SysCallInterfaceDef(decl),
                "StorageContext": decl => new SysCallInterfaceDef(decl),
            }

            const builtInVars: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
                "ByteString": decl => new StaticClassDef(decl),
                "Error": decl => createBuiltInCallable(decl, { parseArguments: invokeError }),
                "Runtime": decl => new StaticClassDef(decl),
                "Storage": decl => new StaticClassDef(decl),
            }

            symbolDefs = resolveBuiltins(builtInEnums)(decls.enums)(symbolDefs);
            symbolDefs = resolveBuiltins(builtInFunctions)(decls.functions)(symbolDefs);
            symbolDefs = resolveBuiltins(builtInInterfaces)(decls.interfaces)(symbolDefs);
            symbolDefs = resolveBuiltins(builtInVars)(decls.variables)(symbolDefs);

            const names = symbolDefs.map(v => [v.symbol.getName(), v]).sort();
            const scope = createScope()(symbolDefs);
            return [scope, diagnostics];
        }

type LibraryDeclaration = tsm.EnumDeclaration | tsm.FunctionDeclaration | tsm.InterfaceDeclaration | tsm.VariableDeclaration;

function findDecls<T extends LibraryDeclaration>(declarations: ReadonlyArray<T>) {
    return (name: string) => pipe(declarations, ROA.filter(v => v.getName() === name));
}

function findDecl<T extends LibraryDeclaration>(declarations: ReadonlyArray<T>) {
    return (name: string) => pipe(name, findDecls(declarations), single);
}

const resolveBuiltins =
    <T extends LibraryDeclaration>(map: ROR.ReadonlyRecord<string, (decl: T) => SymbolDef>) =>
        (declarations: readonly T[]) =>
            (symbolDefs: readonly SymbolDef[]) => {

                const defs = pipe(
                    map,
                    ROR.mapWithIndex((key, func) => pipe(
                        key,
                        findDecl(declarations),
                        O.map(func),
                        E.fromOption(() => key),
                    )),
                    ROR.toEntries,
                    ROA.map(([_, def]) => def),
                    checkErrors('unresolved built in variables'),
                )

                return ROA.concat(defs)(symbolDefs);
            }