import * as E from "fp-ts/Either";
import * as tsm from "ts-morph";
import { Scope } from "../scope";
import { CallableSymbolDef, CallResult, GetPropResult, makeParseError, ObjectSymbolDef, ParseError, SymbolDef } from "../symbolDef";
import { isPushInt, Operation, PushDataOperation } from "../types/Operation";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as FP from 'fp-ts'
import { flow, pipe } from "fp-ts/lib/function";
import { parseExpression } from "./expressionProcessor";
import { getArguments } from "../utils";


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

function parseFromArg(node: tsm.Expression) {
    if (tsm.Node.isArrayLiteralExpression(node)) {

    }

    return E.left(makeParseError(node)(`${node.getKindName()} not impl`));
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
    const buffer = new Array<number>();
    for (const op of ops) {
        if (isPushInt(op)) {
            buffer.push(Number(op.value));
        }
        else {
            return E.left(makeParseError()(`${op.kind} not implemented for from method`))
        }
    }

    return E.right({ kind: 'pushdata', value: Uint8Array.from(buffer) });
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
            ROA.sequence(E.either),
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
