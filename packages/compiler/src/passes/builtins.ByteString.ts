import * as tsm from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import * as ROR from 'fp-ts/ReadonlyRecord';
import { Ord as StringOrd } from 'fp-ts/string';

import { CompileError, getErrorMessage, makeParseError, ParseError } from "../utils";
import { Operation } from "../types/Operation";
import { parseExpression } from "./expressionProcessor";
import { ParseCallArgsFunc, Scope } from "../types/CompileTimeObject";
import { makeCompileTimeObject } from "../types/CompileTimeObject";
import { parseCallExpression, parseMethodCallExpression } from "./parseDeclarations";

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

export function makeByteStringConstructor(node: tsm.InterfaceDeclaration) {

    const methods: Record<string, ParseCallArgsFunc> = {
        "fromHex": byteStringFromHex,
        "fromString": byteStringFromString,
        "fromInteger": byteStringFromInteger,
    }

    const { left: errors, right: props } = pipe(
        methods,
        ROR.collect(StringOrd)((key, value) => pipe(
            node,
            TS.getMember(key),
            O.map(sig => makeCompileTimeObject(sig, sig.getSymbolOrThrow(), { loadOps: [], parseCall: value })),
            E.fromOption(() => key)
        )),
        ROA.separate
    );

    if (errors.length > 0) throw new CompileError(`unresolved ByteStringConstructor members: ${errors.join(', ')}`, node);
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError(`no symbol for ${node.getName()}`, node);

    return makeCompileTimeObject(node, symbol, { loadOps: [], getProperty: props })
}

export function makeByteStringInterface(node: tsm.InterfaceDeclaration) {

    // const lengthSig = pipe(node, TS.getMember('length'), O.chain(O.fromPredicate(tsm.Node.isPropertySignature)));

    const asIntCTO = pipe(
        node,
        TS.getMember('asInteger'),
        O.chain(O.fromPredicate(tsm.Node.isMethodSignature)),
        O.bindTo('sig'),
        O.bind('symbol', ({ sig }) => TS.getSymbol(sig)),
        O.map(({ sig, symbol }) => {
            const parseCall: ParseCallArgsFunc = (scope) => (node) => {
                return pipe(
                    node, 
                    parseMethodCallExpression(scope),
                    E.map(ROA.append({ kind: "convert", type: sc.StackItemType.Integer } as Operation))
                )
            }
            return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        })
    );

    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError(`no symbol for ${node.getName()}`, node);

    return pipe(
        O.Do,
        O.bind("asInteger", () => asIntCTO),
        O.map(({ asInteger }) => makeCompileTimeObject(node, symbol, { getProperty: [asInteger] })),
        O.match(
            () => { throw new CompileError('invalid ByteString interface', node) },
            identity
        )
    )
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
