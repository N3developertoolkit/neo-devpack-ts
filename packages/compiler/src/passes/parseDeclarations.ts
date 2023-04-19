import * as tsm from "ts-morph";

import { pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as TS from '../TS';

import { makeParseError } from "../utils";
import { Operation, pushInt, pushString } from "../types/Operation";
import { ParseArgumentsFunc, makeCompileTimeObject } from "../types/CompileTimeObject";
import { parseArguments } from "./expressionProcessor";

export function makeLocalVariable(node: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) {
    const loadOps = [{ kind: "loadlocal", index} as Operation];
    const storeOps = [{ kind: "storelocal", index} as Operation];
    return makeCompileTimeObject(node, symbol, { loadOps, storeOps });
}

export function makeStaticVariable(node: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) {
    const loadOps = [{ kind: "loadstatic", index} as Operation];
    const storeOps = [{ kind: "loadstatic", index} as Operation];
    return makeCompileTimeObject(node, symbol, { loadOps, storeOps });
}

export function makeParameter(node: tsm.ParameterDeclaration, symbol: tsm.Symbol, index: number) {
    const loadOps = [{ kind: "loadarg", index} as Operation];
    const storeOps = [{ kind: "storearg", index} as Operation];
    return makeCompileTimeObject(node, symbol, { loadOps, storeOps });
}

export function makeConstant(node: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, op: Operation) {
    const cto = makeCompileTimeObject(node, symbol, { loadOps: [op] });
    (cto as any).isConstant = true;
    return cto;
}

export function parseEnumDecl(decl: tsm.EnumDeclaration) {
    return pipe(
        decl.getMembers(),
        ROA.map(member => {
            return pipe(
                E.Do,
                E.bind('op', () => pipe(member, getValue, E.mapLeft(e => makeParseError(member)(e)))),
                E.bind('symbol', () => pipe(member, TS.parseSymbol)),
                E.map(({ op, symbol }) => makeCompileTimeObject(decl, symbol, { loadOps: [op] }))

            );
        }),
        ROA.sequence(E.Applicative),
        E.bindTo('props'),
        E.bind('symbol', () => pipe(decl, TS.parseSymbol)),
        E.map(({ props, symbol }) => makeCompileTimeObject(decl, symbol, { loadOps: [], getProperty: props }))
    );

    function getValue(member: tsm.EnumMember): E.Either<string, Operation> {
        const value = member.getValue();
        if (value === undefined)
            return E.left(member.getName());
        if (typeof value === 'number') {
            return Number.isInteger(value)
                ? E.of(pushInt(value) as Operation)
                : E.left(`${decl.getName()}.${member.getName()} invalid non-integer numeric literal ${value}`);
        }
        return E.of(pushString(value) as Operation);
    }
}

export function parseFunctionDecl(node: tsm.FunctionDeclaration) {
    return pipe(
        node,
        TS.parseSymbol,
        E.chain(symbol => {
            if (node.hasDeclareKeyword()) {
                return pipe(
                    node,
                    TS.getTag("event"),
                    O.map(tag => tag.getCommentText() ?? symbol.getName()),
                    O.map(eventName => {
                        const loadOps = [{ kind: 'syscall', name: "System.Runtime.Notify" } as Operation];
                        const parseCall: ParseArgumentsFunc = (scope) => (node) => {
                            return pipe(
                                node,
                                parseArguments(scope),
                                E.map(ROA.concat([
                                    { kind: "pushint", value: BigInt(node.getArguments().length) },
                                    { kind: 'packarray' },
                                    { kind: 'pushdata', value: Buffer.from(eventName, 'utf8') }
                                ] as readonly Operation[]))
                            )
                        }
                    
                        return makeCompileTimeObject(node, symbol, { loadOps, parseCall });
                    
                    }),
                    E.fromOption(() => makeParseError(node)('only @event declare functions supported')),
                );
            } else {
                const loadOps = [{ kind: 'call', method: symbol } as Operation]
                return E.of(makeCompileTimeObject(node, symbol, { loadOps, parseCall: parseArguments }));
            }
        })
    )
}
