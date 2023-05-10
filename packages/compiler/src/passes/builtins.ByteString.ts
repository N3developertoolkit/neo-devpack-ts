import * as tsm from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import * as ROR from 'fp-ts/ReadonlyRecord';
import { Ord as StringOrd } from 'fp-ts/string';

import { CompileError, getErrorMessage, makeParseError, ParseError, single } from "../utils";
import { isPushDataOp, Operation, PushDataOperation } from "../types/Operation";
import { parseExpression } from "./expressionProcessor";
import { BuiltInCallableOptions, checkErrors, createBuiltInObject, parseBuiltInCallables, parseBuiltInSymbols } from "./builtins.SymbolDefs";
import { ParseCallArgsFunc, Scope } from "../types/CompileTimeObject";
import { makeCompileTimeObject } from "../types/CompileTimeObject";

export const byteStringFromHex =
    (_scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                TS.getArguments,
                ROA.head,
                O.chain(O.fromPredicate(tsm.Node.isStringLiteral)),
                E.fromOption(() => 'invalid argument'),
                E.map(expr => expr.getLiteralValue()),
                E.map(value => value.startsWith('0x') || value.startsWith('0X') ? value.substring(2) : value),
                E.chain(value => E.tryCatch(
                    () => Buffer.from(value, "hex"),
                    e => getErrorMessage(e)
                )),
                E.map(value => [<Operation>{ kind: 'pushdata', value }]),
                E.mapLeft(makeParseError(node))
            )
        }

export const byteStringFromString =
    (scope: Scope) => (
        node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node,
            TS.getArguments,
            ROA.head,
            E.fromOption(() => makeParseError(node)('invalid arguments')),
            E.chain(parseExpression(scope))
        )
    }

export const byteStringFromInteger =
    (scope: Scope) => (
        node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node,
            TS.getArguments,
            ROA.head,
            E.fromOption(() => makeParseError(node)('invalid arguments')),
            E.chain(flow(
                parseExpression(scope),
                E.map(ROA.append({ kind: "convert", type: sc.StackItemType.ByteString } as Operation))
            ))
        )
    }

export function makeByteStringConstructor(decl: tsm.InterfaceDeclaration) {

    const methods: Record<string, ParseCallArgsFunc> = {
        "fromHex": byteStringFromHex,
        "fromString": byteStringFromString,
        "fromInteger": byteStringFromInteger,
    }

    const props = pipe(
        methods,
        ROR.collect(StringOrd)((key, value) => pipe(
            decl,
            TS.getMember(key),
            O.map(sig => makeCompileTimeObject(sig, sig.getSymbolOrThrow(), { loadOps: [], parseCall: value })),
            E.fromOption(() => key)
        )),
        checkErrors(`unresolved ${decl.getName()} functions`)
    );

    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError(`no symbol for ${decl.getName()}`, decl);

    return makeCompileTimeObject(decl, symbol, { loadOps: [], getProperty: props})
}

// const byteStringInstanceMethods: Record<string, BuiltInCallableOptions> = {
//     "asInteger": {
//         loadOps: [{ kind: "convert", type: sc.StackItemType.Integer }],
//         parseArguments: (_scope) => (_node) => E.of(ROA.empty)
//     }
// }

// const byteStringInstanceProps: Record<string, ReadonlyArray<Operation>> = {
//     "length": [{ kind: "size" }],
// }

// export function makeByteStringInterface(decl: tsm.InterfaceDeclaration) {
//     const methods = parseBuiltInCallables(decl)(byteStringInstanceMethods);
//     const properties = parseBuiltInSymbols(decl)(byteStringInstanceProps);

//     const props = ROA.concat(methods)(properties);
//     return createBuiltInObject(decl, { props });
// }
