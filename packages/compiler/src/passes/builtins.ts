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
import { ByteStringConstructorDef, ByteStringInterfaceDef } from "./builtins.ByteString";


export function checkErrors(errorMessage: string) {
    return <T>(results: readonly E.Either<string, T>[]): readonly T[] => {
        const { left: errors, right: values } = pipe(results, ROA.separate);
        if (errors.length > 0)
            throw new Error(`${errorMessage}: ${errors.join()}`);

        return values;
    };
}
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

export function rorValues<K extends string, A>(r: Readonly<Record<K, A>>) {
    return pipe(r, ROR.toEntries, ROA.map(t => t[1]));
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

const errorCall =
    (scope: Scope) => (
        node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        const args = getArguments(node);
        if (args.length === 0) {
            const value = Buffer.from("", "utf8");
            return E.right([{ kind: 'pushdata', value }])
        }
        else {
            return parseExpression(scope)(args[0]);
        }
    }

class CallableVariableDef extends $SymbolDef implements CallableSymbolDef {
    readonly loadOps = [];
    readonly props = [];

    constructor(
        readonly decl: tsm.VariableDeclaration,
        readonly parseArguments: ParseArgumentsFunc
    ) {
        super(decl);
    }
}

export class StaticMethodDef extends $SymbolDef implements CallableSymbolDef {
    readonly loadOps = [];
    readonly props = [];
    constructor(
        readonly sig: tsm.MethodSignature,
        readonly parseArguments: ParseArgumentsFunc
    ) {
        super(sig);
    }
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
class CallContractFunctionDef extends $SymbolDef implements CallableSymbolDef {
    readonly loadOps = [];
    readonly props = [];

    parseArguments = (scope: Scope) => (node: tsm.CallExpression): E.Either<ParseError, ReadonlyArray<Operation>> => {
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

    constructor(
        readonly decl: tsm.FunctionDeclaration,
    ) {
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

class SysCallFunctionDef extends $SymbolDef implements CallableSymbolDef {
    readonly serviceName: string;
    readonly loadOps: readonly Operation[];
    readonly props = [];
    readonly parseArguments: ParseArgumentsFunc;

    constructor(
        readonly decl: tsm.FunctionDeclaration,
    ) {
        super(decl);
        this.serviceName = pipe(
            decl,
            TS.getTagComment('syscall'),
            O.match(
                () => { throw new Error(`invalid service name for ${this.symbol.getName()} syscall function`); },
                identity
            )
        )
        this.loadOps = [{ kind: "syscall", name: this.serviceName }]
        this.parseArguments = parseArguments;
    }
}

class StackItemPropertyDef extends $SymbolDef {
    readonly loadOps: readonly Operation[];

    constructor(
        readonly sig: tsm.PropertySignature,
        readonly index: number
    ) {
        super(sig);
        this.loadOps = [
            { kind: 'pushint', value: BigInt(index) },
            { kind: 'pickitem' }
        ];
    }
}

class StackItemDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props: ReadonlyArray<StackItemPropertyDef>;

    constructor(
        readonly decl: tsm.InterfaceDeclaration,
    ) {
        super(decl);

        if (this.type.getProperties().length !==
            decl.getMembers().length) {
            throw new Error(`invalid @stackitem ${this.name}`)
        }

        this.props = pipe(
            decl.getMembers(),
            ROA.mapWithIndex((index, member) => pipe(
                member,
                E.fromPredicate(
                    tsm.Node.isPropertySignature,
                    () => `${member.getSymbol()?.getName()} (${member.getKindName()})`
                ),
                E.map(sig => new StackItemPropertyDef(sig, index))
            )),
            checkErrors("Invalid stack item members")
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

    private static regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\}/;
    static makeNativeContract(decl: tsm.VariableDeclaration): ReadonlyArray<SymbolDef> {
        const hash = pipe(
            decl,
            getVariableStatement,
            O.chain(TS.getTagComment("nativeContract")),
            O.chain(REGEX.match(NativeContractConstructorDef.regexMethodToken)),
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
}

const regexOperation = /(\S+)\s?(\S+)?/
const parseOperation =
    (node: tsm.Node) =>
        (comment: string): E.Either<string, Operation> => {
            const matches = comment.match(regexOperation) ?? [];
            const error = `invalid operation tag comment "${comment}"`;
            return matches.length === 3
                ? pipe(
                    $parseOperation(matches[1], matches[2]),
                    E.fromNullable(error)
                )
                : E.left(error);
        }

class OperationsFunctionDef extends $SymbolDef implements CallableSymbolDef {
    readonly props = [];
    readonly loadOps: readonly Operation[];

    parseArguments(scope: Scope) {
        return (node: tsm.CallExpression) => {
            return pipe(
                node,
                getArguments,
                ROA.map(parseExpression(scope)),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten),
            );
        }
    }

    constructor(
        readonly decl: tsm.FunctionDeclaration,
    ) {
        super(decl);
        this.loadOps = pipe(
            decl.getJsDocs(),
            ROA.chain(d => d.getTags()),
            ROA.filter(t => t.getTagName() === 'operation'),
            ROA.map(t => t.getCommentText() ?? ""),
            ROA.map(parseOperation(decl)),
            checkErrors('@operation issues')
        )
    }
}

class EnumMemberSymbolDef extends $SymbolDef {
    readonly loadOps: readonly Operation[];

    constructor(
        readonly decl: tsm.EnumMember,
    ) {
        super(decl);
        const value = decl.getValue();
        if (value === undefined) throw new Error(`invalid EnumMemberSymbolDef ${this.name}`)
        if (typeof value === 'number') {
            this.loadOps = [{ kind: "pushint", value: BigInt(value) }];
        } else {
            this.loadOps = [{ kind: "pushdata", value: Buffer.from(value, 'utf8') }];
        }
    }

}

class EnumSymbolDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props: ReadonlyArray<SymbolDef>
    readonly loadOps = [];

    constructor(
        readonly decl: tsm.EnumDeclaration,
    ) {
        super(decl);
        this.props = pipe(
            decl.getMembers(),
            ROA.map(m => new EnumMemberSymbolDef(m))
        )
    }

}


export const makeGlobalScope =
    (decls: LibraryDeclarations): CompilerState<Scope> =>
        diagnostics => {

            let symbolDefs: ReadonlyArray<SymbolDef> = ROA.empty;

            symbolDefs = pipe(
                decls.interfaces,
                ROA.filter(TS.hasTag("stackitem")),
                ROA.map(decl => new StackItemDef(decl)),
                ROA.concat(symbolDefs)
            )

            symbolDefs = pipe(
                decls.variables,
                ROA.filter(flow(
                    getVariableStatement,
                    O.map(TS.hasTag('nativeContract')),
                    O.match(() => false, identity)
                )),
                ROA.map(NativeContractConstructorDef.makeNativeContract),
                ROA.flatten,
                ROA.concat(symbolDefs)
            )

            symbolDefs = pipe(
                decls.functions,
                ROA.filter(TS.hasTag('syscall')),
                ROA.map(decl => new SysCallFunctionDef(decl)),
                ROA.concat(symbolDefs)
            )

            symbolDefs = pipe(
                decls.functions,
                ROA.filter(TS.hasTag('operation')),
                ROA.map(decl => new OperationsFunctionDef(decl)),
                ROA.concat(symbolDefs)
            )

            const builtInEnums: Record<string, (decl: tsm.EnumDeclaration) => SymbolDef> = {
                "CallFlags": decl => new EnumSymbolDef(decl),
                "FindOptions": decl => new EnumSymbolDef(decl),
            }


            const builtInFunctions: Record<string, (decl: tsm.FunctionDeclaration) => SymbolDef> = {
                "callContract": decl => new CallContractFunctionDef(decl),
            }

            const builtInInterfaces: Record<string, (decl: tsm.InterfaceDeclaration) => SymbolDef> = {
                "ByteStringInstance": decl => new ByteStringInterfaceDef(decl),
                "ByteStringConstructor": decl => new ByteStringConstructorDef(decl),
                "ReadonlyStorageContext": decl => new SysCallInterfaceDef(decl),
                "RuntimeConstructor": decl => new SysCallInterfaceDef(decl),
                "StorageConstructor": decl => new SysCallInterfaceDef(decl),
                "StorageContext": decl => new SysCallInterfaceDef(decl),
            }

            const builtInVars: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
                "ByteString": decl => new StaticClassDef(decl),
                "Error": decl => new CallableVariableDef(decl, errorCall),
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