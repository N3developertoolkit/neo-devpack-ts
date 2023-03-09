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
import { SymbolDef } from "../symbolDef";
import { isVoidLike } from "../utils";

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

class StaticClassDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly name: string;
    readonly typeSymbol: tsm.Symbol;
    readonly typeName: string;

    constructor(
        readonly decl: tsm.VariableDeclaration,
    ) {
        this.symbol = decl.getSymbolOrThrow();
        this.name = this.symbol.getName();
        const type = decl.getType();
        this.typeSymbol = type.getSymbolOrThrow();
        this.typeName = this.typeSymbol.getName();
    }
}

class ByteStringConstructorDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly name: string;
    readonly props: ReadonlyArray<{
        readonly symbol: tsm.Symbol,
        readonly signature: tsm.MethodSignature;
        readonly name: string;
    }>

    constructor(readonly decl: tsm.InterfaceDeclaration) {
        this.symbol = decl.getSymbolOrThrow();
        this.name = this.symbol.getName();
        this.props = pipe(
            decl.getMembers(),
            ROA.map(
                E.fromPredicate(
                    tsm.Node.isMethodSignature, 
                    n => n?.getSymbol()?.getName() ?? "<unknown>")
            ),
            ROA.map(E.map(signature => ({
                signature,
                symbol: signature.getSymbolOrThrow(),
                name: signature.getSymbolOrThrow().getName(),
            }))),
            checkErrors("ByteStringConstructorDef invalid members")
        );
    }
}

interface SysCallMember {
    readonly symbol: tsm.Symbol,
    readonly name: string;
    readonly signature: tsm.MethodSignature | tsm.PropertySignature;
    readonly serviceName: string;
}

class SysCallInterfaceDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly name: string;
    readonly props: ReadonlyArray<SysCallMember>;

    constructor(readonly decl: tsm.InterfaceDeclaration) {
        this.symbol = decl.getSymbolOrThrow();
        this.name = this.symbol.getName();
        this.props = pipe(
            decl.getMembers(),
            ROA.map(signature => pipe(
                signature,
                TS.getTagComment('syscall'),
                O.map(serviceName => ({
                    symbol: signature.getSymbolOrThrow(),
                    name: signature.getSymbolOrThrow().getName(),
                    signature,
                    serviceName
                } as SysCallMember)),
                E.fromOption(() => signature.getSymbol()?.getName() ?? "<unknown>")
            )),
            checkErrors(`Invalid ${this.name} members`),
        )
    }
}

class StackItemDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly name: string;
    readonly props: ReadonlyArray<{
        readonly symbol: tsm.Symbol;
        readonly name: string;
        readonly signature: tsm.PropertySignature,
        readonly index: number,
    }>

    constructor(
        readonly decl: tsm.InterfaceDeclaration,
    ) {
        this.symbol = decl.getSymbolOrThrow();
        this.name = this.symbol.getName();

        this.props = pipe(
            decl.getMembers(),
            ROA.mapWithIndex((index, member) => pipe(
                member,
                E.fromPredicate(
                    tsm.Node.isPropertySignature,
                    () => `${member.getSymbol()?.getName()} (${member.getKindName()})`
                ),
                E.map(signature => ({ 
                    signature, 
                    index, 
                    symbol: signature.getSymbolOrThrow(), 
                    name: signature.getSymbolOrThrow().getName() 
                }))
            )),
            checkErrors("Invalid stack item members")
        )
    }
}

class NativeContractConstructorDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly name: string;
    readonly props: ReadonlyArray<{
        readonly signature: tsm.MethodSignature | tsm.PropertySignature;
        readonly symbol: tsm.Symbol;
        readonly name: string,
        readonly parameterCount: number,
        readonly hasReturnValue: boolean,
    }>

    constructor(
        readonly hash: u.HexString,
        readonly decl: tsm.InterfaceDeclaration,
    ) {
        this.symbol = decl.getSymbolOrThrow();
        this.name = this.symbol.getName();
        this.props = pipe(
            decl.getMembers(),
            ROA.map(member => pipe(
                member,
                O.fromPredicate(isMethodOrProp),
                O.map(signature => {
                    const symbol = signature.getSymbolOrThrow();
                    const name = pipe(
                        signature,
                        TS.getTagComment("nativeContract"),
                        O.match(() => symbol.getName(), identity));
                    return {
                        signature,
                        symbol,
                        name,
                        parameterCount: tsm.Node.isMethodSignature(signature)
                            ? signature.getParameters().length
                            : 0,
                        hasReturnValue: tsm.Node.isMethodSignature(signature)
                            ? !isVoidLike(signature.getReturnType())
                            : !isVoidLike(signature.getType()),
                    }
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

class SysCallFunctionDef implements SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly name: string;
    readonly serviceName: string;

    constructor(
        readonly decl: tsm.FunctionDeclaration,
    ) {
        this.symbol = decl.getSymbolOrThrow();
        this.name = this.symbol.getName();
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