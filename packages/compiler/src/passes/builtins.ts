import * as E from "fp-ts/Either";
import * as tsm from "ts-morph";
import { createSymbolMap, Scope } from "../scope";
import { CallableSymbolDef, CallResult, GetPropResult, makeParseError, ObjectSymbolDef, ParseError, SymbolDef } from "../symbolDef";
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

const builtInMap: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
    "Error": makeErrorObj,
    "Uint8Array": makeU8ArrayObj
}

export const makeGlobalScope =
    ({ variables }: LibraryDeclarations): CompilerState<Scope> =>
        diagnostics => {
            let symbols: ReadonlyArray<SymbolDef> = ROA.empty;
            for (const key in builtInMap) {
                [, symbols] = resolveBuiltin(variables)(key, builtInMap[key])(symbols);
            }

            const scope = {
                parentScope: O.none,
                symbols: createSymbolMap(symbols)
            };

            return [scope, diagnostics];
        }