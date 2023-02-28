import * as E from "fp-ts/Either";
import * as tsm from "ts-morph";
import { Scope } from "../scope";
import { CallableSymbolDef, CallResult, GetPropResult, makeParseError, ObjectSymbolDef, ParseError, SymbolDef } from "../symbolDef";
import { isPushIntOp, Operation, PushDataOperation } from "../types/Operation";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as FP from 'fp-ts'
import { flow, pipe } from "fp-ts/lib/function";
import { parseExpression } from "./expressionProcessor";
import { getArguments } from "../utils";


export const resolveBuiltin =
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

export const makeErrorObj = (decl: tsm.VariableDeclaration): CallableSymbolDef => {
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

const asPushData = (ops: ReadonlyArray<Operation>): E.Either<ParseError, Operation> => {
    return pipe(ops,
        ROA.map(op => pipe(
            op,
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
        E.map(buffer => ({ kind: 'pushdata', value: Uint8Array.from(buffer) } as Operation))
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
        E.chain(e => pipe(
            e,
            ROA.map(parseExpression(scope)),
            ROA.sequence(E.Applicative),
            E.map(ROA.flatten)
        )),
        E.chain(asPushData),
        E.map(op => ({
            args: [],
            call: [op]
        }))
    );
}

export const makeU8ArrayObj = (decl: tsm.VariableDeclaration): ObjectSymbolDef => {

    const fromObj: CallableSymbolDef = {
        symbol: decl.getType().getPropertyOrThrow('from'),
        parseGetProp: () => O.none,
        parseCall: callU8ArrayFrom
    };

    return {
        symbol: decl.getSymbolOrThrow(),
        parseGetProp: (prop: tsm.Symbol) =>
            fromObj.symbol === prop
                ? O.some({ value: fromObj, access: [] })
                : O.none,
    }
}

export const builtInMap: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
    "Error": makeErrorObj,
    "Uint8Array": makeU8ArrayObj
}
