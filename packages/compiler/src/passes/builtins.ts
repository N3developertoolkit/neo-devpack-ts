import * as E from "fp-ts/Either";
import * as tsm from "ts-morph";
import { createSymbolMap, Scope } from "../scope";
import { CallableSymbolDef, CallResult, GetPropResult, makeParseError, MethodTokenSymbolDef, ObjectSymbolDef, ParseError, SymbolDef, SysCallSymbolDef } from "../symbolDef";
import { isPushIntOp, Operation, PushDataOperation } from "../types/Operation";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import { flow, identity, pipe } from "fp-ts/lib/function";
import { parseExpression } from "./expressionProcessor";
import { getArguments, isVoidLike } from "../utils";
import { LibraryDeclarations } from "../projectLib";
import { CompilerState } from "../compiler";
import * as TS from "../utility/TS";
import { sc, u } from "@cityofzion/neon-core";

const single = <T>(array: ReadonlyArray<T>): O.Option<T> => array.length === 1 ? O.some(array[0] as T) : O.none;
const checkErrors = (errorMessage: string) =>
    <T>(results: readonly E.Either<string, T>[]): readonly T[] => {
        const { left: errors, right: values } = pipe(results, ROA.separate);
        if (errors.length > 0) throw new Error(`${errorMessage}: ${errors.join()}`);

        return values;
    }

const getVariableStatement = (node: tsm.VariableDeclaration) => O.fromNullable(node.getVariableStatement());

const makeParseGetProp = (props: ReadonlyArray<SymbolDef | GetPropResult>):
    ((prop: tsm.Symbol) => O.Option<GetPropResult>) => {
    const map = ROM.fromMap(
        new Map(props.map(p => {
            const r = 'symbol' in p ? { value: p, access: [] } : p;
            return [r.value.symbol, r];
        }))
    );
    return flow(s => map.get(s), O.fromNullable);
}

function callError(node: tsm.CallExpression, scope: Scope): E.Either<ParseError, CallResult> {
    return pipe(
        node,
        getArguments,
        ROA.head,
        O.match(
            () => E.right([{ kind: 'pushdata', value: Buffer.from("", "utf8") } as Operation]),
            parseExpression(scope)
        ),
        E.bindTo('args'),
        E.bind('call', () => E.right([]))
    )
}

const makeErrorObj = (decl: tsm.VariableDeclaration): CallableSymbolDef => {
    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: () => O.none,
        parseCall: callError
    }
}

const asArrayLiteral = (node: tsm.Node) =>
    pipe(
        node,
        E.fromPredicate(
            tsm.Node.isArrayLiteralExpression,
            () => makeParseError(node)(`${node.getKindName()} not implemented`)
        )
    );

const asPushDataOp = (ops: ReadonlyArray<Operation>) => {
    return pipe(ops,
        ROA.map(flow(
            E.fromPredicate(
                isPushIntOp,
                op => makeParseError()(`${op.kind} not supported for Uint8Array.from`)
            ),
            E.chain(op => op.value < 0 || op.value > 255
                ? E.left(makeParseError()(`${op.value} not supported for Uint8Array.from`))
                : E.right(Number(op.value)),
            )
        )),
        ROA.sequence(E.Applicative),
        E.map(buffer => ({ kind: 'pushdata', value: Uint8Array.from(buffer) } as PushDataOperation))
    );
}

function callU8ArrayFrom(node: tsm.CallExpression, scope: Scope): E.Either<ParseError, CallResult> {
    return pipe(
        node,
        getArguments,
        ROA.head,
        E.fromOption(() => makeParseError(node)('missing argument')),
        E.chain(asArrayLiteral),
        E.map(l => l.getElements()),
        E.chain(flow(
            ROA.map(parseExpression(scope)),
            ROA.sequence(E.Applicative),
            E.map(ROA.flatten)
        )),
        E.chain(asPushDataOp),
        E.map(op => ({
            args: [],
            call: [op]
        }))
    );
}

const makeU8ArrayObj = (decl: tsm.VariableDeclaration): ObjectSymbolDef => {

    const fromObj: CallableSymbolDef = {
        symbol: decl.getType().getPropertyOrThrow('from'),
        parseGetProp: () => O.none,
        parseCall: callU8ArrayFrom
    };

    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: makeParseGetProp([fromObj]),
    }
}

function isMethodOrProp(node: tsm.Node): node is (tsm.MethodSignature | tsm.PropertySignature) {
    return tsm.Node.isMethodSignature(node) || tsm.Node.isPropertySignature(node);
}

const makeStorageInstanceCallObj = (decl: tsm.MethodSignature | tsm.PropertySignature): GetPropResult => {

    const symbol = decl.getSymbolOrThrow();

    const parseGetProp = pipe(
        decl,
        TS.getType,
        TS.getTypeProperties,
        ROA.map(propSym => pipe(
            propSym,
            TS.getSymbolDeclarations,
            single,
            O.chain(O.fromPredicate(isMethodOrProp)),
            O.chain(TS.getTagComment("syscall")),
            O.map(name => new SysCallSymbolDef(propSym, name)),
            E.fromOption(() => propSym.getName())
        )),
        checkErrors(`invalid ${symbol.getName()} members`),
        makeParseGetProp
    );

    const access = pipe(
        decl,
        TS.getTagComment('syscall'),
        O.map(name => ROA.of({ kind: 'syscall', name: name } as Operation)),
        O.match(
            () => { throw new Error(`missing ${symbol.getName()} syscall`) },
            identity
        )
    );

    return {
        value: { symbol, parseGetProp } as ObjectSymbolDef,
        access
    }
}


const makeStorageObj = (decl: tsm.VariableDeclaration): ObjectSymbolDef => {

    const symbol = decl.getSymbolOrThrow();
    const parseGetProp = pipe(
        decl,
        TS.getType,
        TS.getTypeProperties,
        ROA.map(propSym => pipe(
            propSym,
            TS.getSymbolDeclarations,
            single,
            O.chain(O.fromPredicate(isMethodOrProp)),
            O.map(makeStorageInstanceCallObj),
            E.fromOption(() => propSym.getName())
        )),
        checkErrors(`invalid ${symbol.getName()} members`),
        makeParseGetProp
    );

    return { symbol, parseGetProp }
}


function parseRuntimeProperty(node: tsm.PropertySignature) {
    return pipe(
        node,
        TS.getSymbol,
        O.bindTo('symbol'),
        O.bind('loadOperations', () => pipe(
            node,
            TS.getTagComment('syscall'),
            O.map(name => ROA.of({ kind: 'syscall', name } as Operation))
        )),
        O.map(def => def as SymbolDef)
    );
}

const makeRuntimeObj = (decl: tsm.VariableDeclaration): ObjectSymbolDef => {

    const symbol = decl.getSymbolOrThrow();
    const props = pipe(
        decl,
        TS.getType,
        TS.getTypeProperties,
        ROA.map(p => pipe(
            p,
            TS.getSymbolDeclarations,
            single,
            O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
            O.chain(parseRuntimeProperty),
            E.fromOption(() => p.getName()),
        )),
        checkErrors('invalid Runtime properties'),
    );

    return {
        symbol,
        parseGetProp: makeParseGetProp(props),
        loadOperations: [],

    }
}

class StackItemPropSymbolDef implements SymbolDef {

    constructor(
        readonly symbol: tsm.Symbol,
        index: number
    ) {
        this.loadOperations = [
            { kind: 'pushint', value: BigInt(index) },
            { kind: 'pickitem' }
        ]
    }

    loadOperations: readonly Operation[];
}


function makeStackItem(decl: tsm.InterfaceDeclaration): ObjectSymbolDef {

    const props = pipe(
        decl.getMembers(),
        ROA.mapWithIndex((index, member) => pipe(
            member,
            E.fromPredicate(
                tsm.Node.isPropertySignature,
                m => `${m!.getSymbol()?.getName()} (${m!.getKindName()})`
            ),
            E.map(prop => new StackItemPropSymbolDef(prop.getSymbolOrThrow(), index))
        )),
        checkErrors("Invalid stack item members")
    )

    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: makeParseGetProp(props)
    }
}

const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\}/

module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

// const getTypePropDecls = (node: tsm.Node) => {
//     return pipe(
//         node,
//         TS.getType,
//         TS.getTypeProperties,
//         ROA.map(symbol => pipe(
//             symbol,
//             TS.getSymbolDeclarations,
//             single,
//             O.map(declaration => ({ symbol, declaration })),
//             E.fromOption(() => symbol.getName())
//         )),
//     )
// }


function makeNativeContract(decl: tsm.VariableDeclaration): ObjectSymbolDef {

    const symbol = decl.getSymbolOrThrow();
    const props = pipe(
        decl,
        getVariableStatement,
        O.chain(TS.getTagComment("nativeContract")),
        O.chain(REGEX.match(regexMethodToken)),
        O.chain(ROA.lookup(1)),
        O.map(v => u.HexString.fromHex(v, true)),
        O.map(hash => pipe(
            decl,
            TS.getType,
            TS.getTypeProperties,
            ROA.map(propSymbol => pipe(
                propSymbol,
                TS.getSymbolDeclarations,
                single,
                O.chain(O.fromPredicate(isMethodOrProp)),
                O.map(node => new sc.MethodToken({
                    hash: hash.toString(),
                    method: node.getSymbolOrThrow().getName(),
                    parametersCount: tsm.Node.isMethodSignature(node)
                        ? node.getParameters().length
                        : 0,
                    hasReturnValue: tsm.Node.isMethodSignature(node)
                        ? !isVoidLike(node.getReturnType())
                        : !isVoidLike(node.getType()),
                    callFlags: sc.CallFlags.All
                })),
                O.map(mt => new MethodTokenSymbolDef(propSymbol, mt)),
                E.fromOption(() => propSymbol.getName()),
            )),
            checkErrors(`${symbol.getName()} invalid properties`),
        )),
        O.match(()=> { throw new Error(`${symbol.getName()} invalid JSDoc Tag`) }, identity)
    );

    return {
        symbol,
        parseGetProp: makeParseGetProp(props),
    }
}

function makeSysCallFunc(decl: tsm.FunctionDeclaration): CallableSymbolDef {

    const symbol = decl.getSymbolOrThrow();
    return pipe(
        decl,
        TS.getTagComment('syscall'),
        O.map(name => new SysCallSymbolDef(symbol, name)),
        O.match(
            () => { throw new Error(`missing ${symbol.getName()} syscall`) },
            identity
        )
    )
}

const builtInMap: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
    "Error": makeErrorObj,
    "Runtime": makeRuntimeObj,
    "Storage": makeStorageObj,
    "Uint8Array": makeU8ArrayObj
}

export const makeGlobalScope =
    (decls: LibraryDeclarations): CompilerState<Scope> =>
        diagnostics => {

            let symbols: ReadonlyArray<SymbolDef> = ROA.empty;

            const stackItems = pipe(
                decls.interfaces,
                ROA.filter(TS.hasTag("stackitem")),
                ROA.map(makeStackItem)
            )

            symbols = pipe(
                decls.variables,
                ROA.filter(flow(
                    getVariableStatement,
                    O.map(TS.hasTag('nativeContract')),
                    O.match(() => false, identity)
                )),
                ROA.map(makeNativeContract),
                ROA.concat(symbols)
            )

            symbols = pipe(
                decls.functions,
                ROA.filter(TS.hasTag('syscall')),
                ROA.map(makeSysCallFunc),
                ROA.concat(symbols)
            )

            for (const key in builtInMap) {
                [, symbols] = resolveBuiltin(decls.variables)(key, builtInMap[key])(symbols);
            }

            const scope = {
                parentScope: O.none,
                symbols: createSymbolMap(symbols)
            };

            return [scope, diagnostics];
        }

const resolveBuiltin =
    (variables: ReadonlyArray<tsm.VariableDeclaration>) =>
        (name: string, make: (decl: tsm.VariableDeclaration) => SymbolDef): S.State<ReadonlyArray<SymbolDef>, void> =>
            (symbols) => {
                return pipe(
                    variables,
                    ROA.findFirst(v => v.getName() === name),
                    O.map(make),
                    O.match(
                        () => { throw new Error(`built in variable ${name} not found`); },
                        v => [, ROA.append(v)(symbols)]
                    )
                )
            }
