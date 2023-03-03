import * as E from "fp-ts/Either";
import * as tsm from "ts-morph";
import { createSymbolMap, Scope } from "../scope";
import { CallableSymbolDef, CallResult, GetPropResult, LoadSymbolDef, makeParseError, ObjectSymbolDef, ParseError, SymbolDef } from "../symbolDef";
import { isPushIntOp, Operation, PushDataOperation } from "../types/Operation";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import { flow, pipe } from "fp-ts/lib/function";
import { parseExpression } from "./expressionProcessor";
import { getArguments } from "../utils";
import { LibraryDeclarations } from "../projectLib";
import { CompilerState } from "../compiler";

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

const makeStorageObj = (decl: tsm.VariableDeclaration): ObjectSymbolDef => {

    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: () => O.none,
    }
}

const single = <T>(as: ReadonlyArray<T>): O.Option<T> => as.length === 1 ? O.some(as[0]) : O.none;

function parseRuntimeProperty(node: tsm.PropertySignature) {

    return pipe(
        node.getSymbol(),
        O.fromNullable,
        O.bindTo('symbol'),
        O.bind('loadOperations', () => pipe(
            node,
            getTag('syscall'),
            O.fromNullable,
            O.chain(tag => O.fromNullable(tag.getCommentText())),
            O.map(name => ROA.of({ kind: 'syscall', name } as Operation))
        )),
        O.map(({symbol, loadOperations}) => ({symbol, loadOperations} as LoadSymbolDef))
    );
}

const makeRuntimeObj = (decl: tsm.VariableDeclaration): ObjectSymbolDef => {

    const symbol = decl.getSymbolOrThrow();

    const {left: errors, right: props} = pipe(
        decl.getType().getProperties(),
        ROA.map(p => pipe(
            p.getDeclarations(), 
            single,
            O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
            O.chain(parseRuntimeProperty),
            E.fromOption(() => p.getName()),
        )),
        ROA.separate
    );

    if (errors.length > 0) {
        throw new Error(`invalid Runtime properties: ${errors.join()}`);
    }

    return {
        symbol,
        parseGetProp: makeParseGetProp(props),
    }
}



const builtInMap: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
    "Error": makeErrorObj,
    "Runtime": makeRuntimeObj,
    "Storage": makeStorageObj,
    "Uint8Array": makeU8ArrayObj
}

const hasTag = (tagName: string) => (node: tsm.JSDocableNode): boolean => {
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() === tagName) return true;
        }
    }
    return false;
}

const getTag = (tagName: string) => (node: tsm.JSDocableNode) => {
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() === tagName) return tag;
        }
    }
    return undefined
}

class StackItemPropSymbolDef implements LoadSymbolDef {

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

    const { left: errors, right: props } = pipe(
        decl.getMembers(),
        ROA.mapWithIndex((index, member) => pipe(
            member,
            E.fromPredicate(
                tsm.Node.isPropertySignature,
                m => `${m!.getSymbol()?.getName()} (${m!.getKindName()})`
            ),
            E.map(prop => new StackItemPropSymbolDef(prop.getSymbolOrThrow(), index))
        )),
        ROA.separate
    )

    if (errors.length > 0) {
        throw new Error(`Invalid stack item members: ${errors.join()}`);
    }

    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: makeParseGetProp(props)
    }
}

function makeNativeContract(decl: tsm.VariableDeclaration): ObjectSymbolDef {

    // const stmt = decl.getVariableStatementOrThrow();
    // const tag = getTag("nativeContract")(stmt);
    // const type = decl.getType();
    // const members = type.getProperties();

    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: () => O.none,
    }
}

function makeSysCall(decl: tsm.VariableDeclaration): ObjectSymbolDef {

    const symbol = decl.getSymbolOrThrow();
    const type = decl.getType();
    const members = type.getProperties().map(p => p.getDeclarations());




    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: () => O.none,
    }

}
export const makeGlobalScope =
    (decls: LibraryDeclarations): CompilerState<Scope> =>
        diagnostics => {

            const stackItems = pipe(
                decls.interfaces,
                ROA.filter(hasTag("stackitem")),
                ROA.map(makeStackItem)
            )

            const nativeContracts = pipe(
                decls.variables,
                ROA.filter(d => hasTag("nativeContract")(d.getVariableStatementOrThrow())),
                ROA.map(makeNativeContract)
            )

            const syscall = pipe(
                decls.variables,
                ROA.filter(d => hasTag("syscall")(d.getVariableStatementOrThrow())),
                ROA.map(makeSysCall)
            )

            const i = decls.interfaces.map(d => d.getSymbol()?.getName()).sort();
            const v = decls.variables.map(d => d.getSymbol()?.getName()).sort();

            let symbols: ReadonlyArray<SymbolDef> = ROA.empty;
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
                    O.map(v => make(v)),
                    O.match(
                        () => { throw new Error(`built in variable ${name} not found`); },
                        v => [, ROA.append(v)(symbols)]
                    )
                )
            }
