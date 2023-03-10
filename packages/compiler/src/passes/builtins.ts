import * as tsm from "ts-morph";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as ROR from 'fp-ts/ReadonlyRecord'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as STR from 'fp-ts/string';
import * as TS from "../utility/TS";
import { flow, identity, pipe } from "fp-ts/lib/function";
import { LibraryDeclarations } from "../projectLib";
import { CompilerState } from "../compiler";
import { createScope, Scope } from "../scope";
import { sc, u } from "@cityofzion/neon-core";
import { $SymbolDef, ObjectSymbolDef, CallableSymbolDef, ParseError, SymbolDef, makeParseError, ParseArgumentsFunc } from "../symbolDef";
import { isVoidLike, single } from "../utils";
import { Operation, PushIntOperation, SysCallOperation } from "../types";
import { getArguments, parseArguments, parseExpression } from "./expressionProcessor";


function checkErrors(errorMessage: string) {
    return <T>(results: readonly E.Either<string, T>[]): readonly T[] => {
        const { left: errors, right: values } = pipe(results, ROA.separate);
        if (errors.length > 0)
            throw new Error(`${errorMessage}: ${errors.join()}`);

        return values;
    };
}
function checkOption<T>(errorMessage: string) {
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

function rorValues<K extends string, A>(r: Readonly<Record<K, A>>) {
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


const byteStringFromHex =
    (scope: Scope) => (
        node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {

        const q = pipe(
            node,
            getArguments,
            single,
            E.fromOption(() => makeParseError(node)('invalid parameters')),
            E.chain(parseExpression(scope))
            // ROA.map(parseExpression(scope)),
            // ROA.sequence(E.Applicative),
            // E.map(ROA.reverse),
            // E.map(ROA.flatten),
        );

        return E.left(makeParseError(node)('not impl'))

    }

class ByteStringMethodDef extends $SymbolDef {
    readonly loadOps = [];
    constructor(readonly sig: tsm.MethodSignature) {
        super(sig);
    }
}

class StaticMethodDef extends $SymbolDef implements CallableSymbolDef {
    readonly loadOps = [];
    readonly props = [];
    constructor(
        readonly sig: tsm.MethodSignature,
        readonly parseArguments: ParseArgumentsFunc
    ) {
        super(sig);
    }
}


const byteStringMethods: Record<string, ParseArgumentsFunc> = {
    "fromHex": byteStringFromHex
}

class ByteStringConstructorDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props: ReadonlyArray<ByteStringMethodDef>

    constructor(readonly decl: tsm.InterfaceDeclaration) {
        super(decl);
        this.props = pipe(
            byteStringMethods,
            ROR.mapWithIndex((key, func) => {
                return pipe(
                    key,
                    TS.getTypeProperty(this.type),
                    O.chain(sym => pipe(sym.getDeclarations(), single)),
                    O.chain(O.fromPredicate(tsm.Node.isMethodSignature)),
                    O.map(sig => new StaticMethodDef(sig, func)),
                    E.fromOption(() => key)
                );
            }),
            rorValues,
            checkErrors('unresolved ByteString members'),
        );
    }
}

class SysCallInterfaceMethodDef extends $SymbolDef implements CallableSymbolDef {
    loadOps: readonly Operation[];
    readonly props = [];
    readonly parseArguments: (scope: Scope) => (node: tsm.CallExpression) => E.Either<ParseError, readonly Operation[]>;

    constructor(
        readonly sig: tsm.MethodSignature,
        readonly serviceName: string
    ) {
        super(sig);
        this.parseArguments = parseArguments;
        const op: SysCallOperation = { kind: "syscall", name: this.serviceName };
        this.loadOps = [op]
    }
}

class SysCallInterfacePropertyDef extends $SymbolDef implements ObjectSymbolDef {
    loadOps: readonly Operation[];
    readonly props = [];

    constructor(
        readonly sig: tsm.PropertySignature,
        readonly serviceName: string
    ) {
        super(sig);
        const op: SysCallOperation = { kind: "syscall", name: this.serviceName };
        this.loadOps = [op]
    }
}

class SysCallInterfaceDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props: ReadonlyArray<ObjectSymbolDef>;

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

                    return tsm.Node.isMethodSignature(signature)
                        ? new SysCallInterfaceMethodDef(signature, name)
                        : new SysCallInterfacePropertyDef(signature, name);
                }),
                E.fromOption(() => member.getSymbolOrThrow().getName())
            )),
            checkErrors("Invalid syscall interface members")
        )
    }
}

class SysCallFunctionDef extends $SymbolDef implements CallableSymbolDef {
    readonly serviceName: string;
    readonly loadOps = [];
    readonly props = [];
    readonly parseArguments: (scope: Scope) => (node: tsm.CallExpression) => E.Either<ParseError, readonly Operation[]>;

    constructor(
        readonly decl: tsm.FunctionDeclaration,
    ) {
        super(decl);
        this.parseArguments = parseArguments;
        this.serviceName = pipe(
            decl,
            TS.getTagComment('syscall'),
            O.match(
                () => { throw new Error(`invalid service name for ${this.symbol.getName()} syscall function`); },
                identity
            )
        )
    }
}

class StackItemPropertyDef extends $SymbolDef {
    loadOps: readonly Operation[];

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

class NativeContractMethodDef extends $SymbolDef implements CallableSymbolDef {
    props = [];
    loadOps: readonly Operation[];
    parseArguments: (scope: Scope) => (node: tsm.CallExpression) => E.Either<ParseError, readonly Operation[]>;

    constructor(
        readonly sig: tsm.MethodSignature,
        readonly hash: u.HexString,
        readonly method: string,
    ) {
        super(sig);
        this.parseArguments = parseArguments;

        const token = new sc.MethodToken({
            hash: hash.toString(),
            method: method,
            parametersCount: sig.getParameters().length,
            hasReturnValue: !isVoidLike(sig.getReturnType()),
            callFlags: sc.CallFlags.All
        })
        this.loadOps = [
            { kind: 'calltoken', token }
        ]
    }
}

class NativeContractPropertyDef extends $SymbolDef implements ObjectSymbolDef {
    props = [];
    loadOps: readonly Operation[];

    constructor(
        readonly sig: tsm.PropertySignature,
        readonly hash: u.HexString,
        readonly method: string,
    ) {
        super(sig);

        const token = new sc.MethodToken({
            hash: hash.toString(),
            method: method,
            parametersCount: 0,
            hasReturnValue: !isVoidLike(sig.getType()),
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

                    return tsm.Node.isMethodSignature(signature)
                        ? new NativeContractMethodDef(signature, hash, name)
                        : new NativeContractPropertyDef(signature, hash, name);
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

            const builtInVars: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
                "ByteString": decl => new StaticClassDef(decl),
                "Runtime": decl => new StaticClassDef(decl),
                "Storage": decl => new StaticClassDef(decl),
            }

            const builtInInterfaces: Record<string, (decl: tsm.InterfaceDeclaration) => SymbolDef> = {
                "ByteStringConstructor": decl => new ByteStringConstructorDef(decl),
                "ReadonlyStorageContext": decl => new SysCallInterfaceDef(decl),
                "RuntimeConstructor": decl => new SysCallInterfaceDef(decl),
                "StorageConstructor": decl => new SysCallInterfaceDef(decl),
                "StorageContext": decl => new SysCallInterfaceDef(decl),
            }

            symbolDefs = resolveBuiltins(builtInVars)(decls.variables)(symbolDefs);
            symbolDefs = resolveBuiltins(builtInInterfaces)(decls.interfaces)(symbolDefs);

            const scope = createScope()(symbolDefs);
            return [scope, diagnostics];
        }

type LibraryDeclaration = tsm.VariableDeclaration | tsm.InterfaceDeclaration | tsm.FunctionDeclaration;

function findDecls<T extends LibraryDeclaration>(declarations: ReadonlyArray<T>) {
    return (name: string) => pipe(declarations, ROA.filter(v => v.getName() === name));
}

function findDecl<T extends LibraryDeclaration>(declarations: ReadonlyArray<T>) {
    return (name: string) => pipe(name, findDecls(declarations), single);
}

const resolveBuiltins =
    <T extends LibraryDeclaration>(map: ROR.ReadonlyRecord<string, (decl: T) => SymbolDef>) =>
        (declarations: ReadonlyArray<T>) =>
            (symbolDefs: ReadonlyArray<SymbolDef>) => {

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