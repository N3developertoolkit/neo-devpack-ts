import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord'
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";

import { CallableSymbolDef, ObjectSymbolDef, ParseArgumentsFunc, ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { $SymbolDef, makeParseError } from "../symbolDef";
import { single } from "../utils";
import { isPushDataOp, Operation, PushDataOperation } from "../types/Operation";
import { getArguments, parseExpression } from "./expressionProcessor";
import { BuiltInCallableOptions, createBuiltInObject, parseBuiltInCallables, parseBuiltInSymbols } from "./builtins.SymbolDefs";

const fromEncoding =
    (encoding: BufferEncoding) =>
        (value: string): O.Option<Uint8Array> => {
            return O.tryCatch(() => Buffer.from(value, encoding))
        }

const fromHex =
    (value: string): O.Option<Uint8Array> => {
        value = value.startsWith('0x') || value.startsWith('0X')
            ? value.substring(2)
            : value;
        return pipe(
            value,
            fromEncoding('hex'),
            O.chain(buffer => buffer.length * 2 === value.length ? O.some(buffer) : O.none)
        );
    }

const exprAsString = (scope: Scope) => (expr: tsm.Expression): O.Option<string> => {
    return pipe(
        expr,
        parseExpression(scope),
        O.fromEither,
        O.chain(single),
        O.chain(O.fromPredicate(isPushDataOp)),
        O.chain(op => O.tryCatch(() => Buffer.from(op.value).toString()))
    )
}

export const byteStringFromHex =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
            const makeError = makeParseError(node);
            return pipe(
                node,
                getArguments,
                ROA.head,
                E.fromOption(() => makeError('invalid arguments')),
                E.chain(expr => {
                    return pipe(
                        expr,
                        exprAsString(scope),
                        O.chain(fromHex),
                        O.map(value => {
                            return ({ kind: 'pushdata', value } as PushDataOperation);
                        }),
                        O.map(ROA.of),
                        E.fromOption(() => makeError('invalid hex string'))
                    );
                })
            )
        }

export const byteStringFromString =
    (scope: Scope) => (
        node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        const makeError = makeParseError(node);
        return pipe(
            node,
            getArguments,
            ROA.head,
            E.fromOption(() => makeError('invalid arguments')),
            E.chain(expr => {
                return pipe(
                    expr,
                    parseExpression(scope),
                    O.fromEither,
                    O.chain(single),
                    O.chain(O.fromPredicate(isPushDataOp)),
                    O.map(ROA.of),
                    E.fromOption(() => makeError('invalid string argument'))
                )
            })
        )
    }

export const byteStringFromInteger =
    (scope: Scope) => (
        node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        const makeError = makeParseError(node);

        return pipe(
            node,
            getArguments,
            ROA.head,
            E.fromOption(() => makeError('invalid arguments')),
            E.chain(expr => {
                return pipe(
                    expr,
                    parseExpression(scope),
                    E.map(ROA.append({ kind: "convert", type: sc.StackItemType.ByteString } as Operation))
                )
            })
        )
    }

const byteStringCtorMethods: Record<string, BuiltInCallableOptions> = {
    "fromHex": { parseArguments: byteStringFromHex },
    "fromString": { parseArguments: byteStringFromString },
    "fromInteger": { parseArguments: byteStringFromInteger },
};

export function makeByteStringConstructor(decl: tsm.InterfaceDeclaration) {
    const props = parseBuiltInCallables(decl)(byteStringCtorMethods);
    return createBuiltInObject(decl, { props });
}

const byteStringInstanceMethods: Record<string, BuiltInCallableOptions> = {
    "asInteger": {
        loadOps: [{ kind: "convert", type: sc.StackItemType.Integer }],
        parseArguments: (_scope) => (_node) => E.of(ROA.empty)
    }
}

const byteStringInstanceProps: Record<string, ReadonlyArray<Operation>> = {
    "length": [{ kind: "size" }],
}

export function makeByteStringInterface(decl: tsm.InterfaceDeclaration) {
    const methods = parseBuiltInCallables(decl)(byteStringInstanceMethods);
    const properties = parseBuiltInSymbols(decl)(byteStringInstanceProps);

    const props = ROA.concat(methods)(properties);
    return createBuiltInObject(decl, { props });
}
