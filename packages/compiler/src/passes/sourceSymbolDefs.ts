import * as tsm from "ts-morph";
import { Operation } from "../types/Operation";
import { ParseArgumentsFunc, makeCompileTimeObject } from "../types/CompileTimeObject";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as E from "fp-ts/Either";
import * as TS from '../TS';
import { pipe } from "fp-ts/function";
import { parseArguments } from "./expressionProcessor";

function parseStore(loadOps: readonly Operation[], valueOps: readonly Operation[], storeOp: Operation) {
    return pipe(
        valueOps,
        ROA.concat(loadOps),
        ROA.append(storeOp),
        E.of
    );
}

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

export function parseParameter(node: tsm.ParameterDeclaration, index: number) {
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => makeParameter(node, symbol, index))
    )
}

export function makeConstant(node: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, op: Operation) {
    const cto = makeCompileTimeObject(node, symbol, { loadOps: [op] });
    (cto as any).isConstant = true;
    return cto;
}

export function parseConstant(node: tsm.Identifier | tsm.BindingElement, op:Operation) {
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => makeConstant(node, symbol, op))
    )
}

export function makeEventFunction(node: tsm.FunctionDeclaration, symbol: tsm.Symbol, eventName: string) {
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
}

export function parseEventFunction(node: tsm.FunctionDeclaration, tag: tsm.JSDocTag) {
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => {
            const eventName = tag.getCommentText() ?? symbol.getName();
            return makeEventFunction(node, symbol, eventName);
        })
    );
}

export function makeFunction(node: tsm.FunctionDeclaration, symbol: tsm.Symbol) {
    const loadOps = [{ kind: 'call', method: symbol } as Operation]
    return makeCompileTimeObject(node, symbol, { loadOps, parseCall: parseArguments });
}

export function parseFunction(node: tsm.FunctionDeclaration) {
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => makeFunction(node, symbol))
    );
}
