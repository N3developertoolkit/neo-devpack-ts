import * as tsm from "ts-morph";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { flow, identity, pipe } from "fp-ts/lib/function";
import { LibraryDeclarations } from "../projectLib";
import { CompilerState } from "../compiler";
import { createScope, Scope } from "../scope";
import { sc, u } from "@cityofzion/neon-core";
import { $SymbolDef, ObjectSymbolDef, SymbolDef } from "../symbolDef";
import { isVoidLike } from "../utils";
import { Operation, SysCallOperation } from "../types";

function single<T>(array: ReadonlyArray<T>): O.Option<T> {
    return array.length === 1 ? O.some(array[0] as T) : O.none;
}
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

module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

class StaticClassDef extends $SymbolDef {
    readonly loadOps: ReadonlyArray<Operation> = [];

    constructor(readonly decl: tsm.VariableDeclaration) {
        super(decl);
    }
}

class ByteStringMethodDef extends $SymbolDef {
    readonly loadOps = [];
    constructor(readonly sig: tsm.MethodSignature) {
        super(sig);
    }
}

class ByteStringConstructorDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props: ReadonlyArray<ByteStringMethodDef>

    constructor(readonly decl: tsm.InterfaceDeclaration) {
        super(decl);
        this.props = pipe(
            this.type.getProperties(),
            ROA.chain(symbol => symbol.getDeclarations()),
            ROA.map(member => pipe(
                member,
                E.fromPredicate(
                    tsm.Node.isMethodSignature,
                    n => member.getSymbolOrThrow().getName()),
            )),
            ROA.map(
                E.map(sig => new ByteStringMethodDef(sig))
            ),
            checkErrors("ByteStringConstructorDef invalid members")
        );
    }
}

class SysCallInterfaceMemberDef extends $SymbolDef {
    get loadOps() {
        return [this.sysCallOp]
    }

    private get sysCallOp(): SysCallOperation {
        return { kind: "syscall", name: this.serviceName };
    }

    constructor(
        readonly sig: tsm.MethodSignature | tsm.PropertySignature,
        readonly serviceName: string
    ) {
        super(sig);
    }
}

class SysCallInterfaceDef extends $SymbolDef implements ObjectSymbolDef {
    readonly props: ReadonlyArray<SysCallInterfaceMemberDef>;

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

class SysCallFunctionDef extends $SymbolDef {
    readonly serviceName: string;
    readonly loadOps = [];

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
    }
}

class StackItemPropertyDef extends $SymbolDef {

    constructor(
        readonly sig: tsm.PropertySignature,
        readonly index: number
    ) {
        super(sig);
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

class NativeContractMemberDef extends $SymbolDef {

    constructor(
        readonly sig: tsm.MethodSignature | tsm.PropertySignature,
        readonly hash: u.HexString,
        readonly method: string,
    ) {
        super(sig);
    }

    get parameterCount() {
        return tsm.Node.isMethodSignature(this.sig)
            ? this.sig.getParameters().length
            : 0;
    }

    get hasReturnValue() {
        const type = tsm.Node.isMethodSignature(this.sig)
            ? this.sig.getReturnType()
            : this.sig.getType();
        return !isVoidLike(type);
    }

    get methodToken() {
        return new sc.MethodToken({
            hash: this.hash.toString(),
            method: this.method,
            parametersCount: this.parameterCount,
            hasReturnValue: this.hasReturnValue,
            callFlags: sc.CallFlags.All
        })
    }
}

class NativeContractConstructorDef extends $SymbolDef implements ObjectSymbolDef {
    readonly loadOps: ReadonlyArray<Operation> = [];
    readonly props: ReadonlyArray<NativeContractMemberDef>

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
    <T extends LibraryDeclaration>(map: Record<string, (decl: T) => SymbolDef>) =>
        (declarations: ReadonlyArray<T>) =>
            (symbolDefs: ReadonlyArray<SymbolDef>) => {
                for (const key in map) {
                    symbolDefs = pipe(
                        key,
                        findDecl(declarations),
                        O.map(map[key]),
                        checkOption(`built in variable ${key} not found`),
                        def => ROA.append(def)(symbolDefs)
                    )
                }
                return symbolDefs;
            }