import * as tsm from "ts-morph";

import { pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as TS from '../TS';
import * as ROR from 'fp-ts/ReadonlyRecord';
import { Ord as StringOrd } from 'fp-ts/string';

import { CompileError, makeParseError } from "../utils";
import { Operation, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, Scope, ScopedNodeFunc, makeCompileTimeObject } from "../types/CompileTimeObject";
import { parseExpression } from "./expressionProcessor";

export function makeLocalVariable(node: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) {
    const loadOps = [{ kind: "loadlocal", index } as Operation];
    const storeOps = [{ kind: "storelocal", index } as Operation];
    return makeCompileTimeObject(node, symbol, { loadOps, storeOps });
}

export function makeStaticVariable(node: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) {
    const loadOps = [{ kind: "loadstatic", index } as Operation];
    const storeOps = [{ kind: "loadstatic", index } as Operation];
    return makeCompileTimeObject(node, symbol, { loadOps, storeOps });
}

export function makeParameter(node: tsm.ParameterDeclaration, symbol: tsm.Symbol, index: number) {
    const loadOps = [{ kind: "loadarg", index } as Operation];
    const storeOps = [{ kind: "storearg", index } as Operation];
    return makeCompileTimeObject(node, symbol, { loadOps, storeOps });
}

export function makeConstant(node: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, op: Operation) {
    const cto = makeCompileTimeObject(node, symbol, { loadOps: [op] });
    (cto as any).isConstant = true;
    return cto;
}

export function parseArguments(scope: Scope) {
    return (args: readonly tsm.Expression[]) => {
        return pipe(
            args,
            ROA.map(parseExpression(scope)),
            ROA.sequence(E.Applicative),
            E.map(ROA.reverse),
            E.map(ROA.flatten)
        );
    };
}

export const parseCallExpression = (scope: Scope) => (node: tsm.CallExpression) => {
    return pipe(
        node,
        TS.getArguments,
        parseArguments(scope),
    );
}

export const parseMethodCallExpression = (scope: Scope) => (node: tsm.CallExpression) => {
    const expr = node.getExpression();
    if (tsm.Node.hasExpression(expr)) {
        return pipe(
            node,
            TS.getArguments,
            ROA.prepend(expr.getExpression()),
            parseArguments(scope),
        );
    } else {
        return E.left(makeParseError(node)('invalid method call expression'));
    }
}

export function parseEnumDecl(decl: tsm.EnumDeclaration) {
    return pipe(
        decl.getMembers(),
        ROA.map(member => pipe(
            E.Do,
            E.bind('op', () => pipe(member, getValue, E.mapLeft(e => makeParseError(member)(e)))),
            E.bind('symbol', () => pipe(member, TS.parseSymbol)),
            E.map(({ op, symbol }) => makeCompileTimeObject(member, symbol, { loadOps: [op] }))
        )),
        ROA.sequence(E.Applicative),
        E.bindTo('props'),
        E.bind('symbol', () => pipe(decl, TS.parseSymbol)),
        E.map(({ props, symbol }) => makeCompileTimeObject(decl, symbol, { loadOps: [], getProperty: props }))
    );

    function getValue(member: tsm.EnumMember): E.Either<string, Operation> {
        const value = member.getValue();
        if (value === undefined)
            return E.left(`${decl.getName()}.${member.getName()} undefined value`);
        if (typeof value === 'number') {
            return Number.isInteger(value)
                ? E.of(pushInt(value))
                : E.left(`${decl.getName()}.${member.getName()} invalid non-integer numeric literal ${value}`);
        }
        return E.of(pushString(value));
    }
}

function parseEventFunctionDecl(node: tsm.FunctionDeclaration) {
    return pipe(
        E.Do,
        E.bind('symbol', () => pipe(node, TS.parseSymbol)),
        E.bind('eventName', ({ symbol }) => pipe(
            node,
            TS.getTag("event"),
            O.map(tag => tag.getCommentText() ?? symbol.getName()),
            E.fromOption(() => makeParseError(node)('event name required'))
        )),
        E.map(({ symbol, eventName }) => {
            const loadOps = [{ kind: 'syscall', name: "System.Runtime.Notify" } as Operation];
            const parseCall: ScopedNodeFunc<tsm.CallExpression> = (scope) => (node) => {
                return pipe(
                    node,
                    parseCallExpression(scope),
                    E.map(ROA.concat([
                        { kind: "pushint", value: BigInt(node.getArguments().length) },
                        { kind: 'packarray' },
                        { kind: 'pushdata', value: Buffer.from(eventName, 'utf8') }
                    ] as readonly Operation[]))
                )
            }
            return makeCompileTimeObject(node, symbol, { loadOps, parseCall });
        })
    )
}

export function parseFunctionDecl(node: tsm.FunctionDeclaration) {

    if (node.hasDeclareKeyword()) {
        if (TS.hasTag("event")(node)) return parseEventFunctionDecl(node);
        return E.left(makeParseError(node)('invalid declare function'));
    }

    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => makeCompileTimeObject(node, symbol, {
            loadOps: [{ kind: 'call', method: symbol }],
            parseCall: parseCallExpression
        }))
    )
}

function parseInterfaceMembers(node: tsm.Node, members: readonly tsm.TypeElementTypes[]) {

    const props = pipe(members, ROA.filter(tsm.Node.isPropertySignature));
    if (props.length != members.length) {
        return E.left(makeParseError(node)('only property interface members supported'));
    }

    const propsE = TS.hasTag("struct")
        ? pipe(
            props,
            ROA.mapWithIndex((index, prop) => pipe(
                prop,
                TS.parseSymbol,
                E.map(symbol => {
                    const indexOp = pushInt(index);
                    return makeCompileTimeObject(prop, symbol, {
                        loadOps: [indexOp, { kind: 'pickitem' }],
                        storeOps: [indexOp, { kind: 'setitem' }]
                    });
                })
            ))
        )
        : pipe(
            props,
            ROA.map(prop => pipe(
                prop,
                TS.parseSymbol,
                E.map(symbol => {
                    const nameOp = pushString(symbol.getName());
                    return makeCompileTimeObject(prop, symbol, {
                        loadOps: [nameOp, { kind: 'pickitem' }],
                        storeOps: [nameOp, { kind: 'setitem' }]
                    });
                })
            ))
        );

    return pipe(
        propsE,
        ROA.sequence(E.Applicative),
        E.bindTo('props'),
        E.bind('symbol', () => pipe(node, TS.parseSymbol)),
        E.map(({ props, symbol }) => makeCompileTimeObject(node, symbol, { loadOps: [], getProperty: props }))
    );
}

export function parseTypeAliasDecl(node: tsm.TypeAliasDeclaration) {
    const type = node.getType();
    if (type.isTuple()) {
        return pipe(
            node,
            TS.parseSymbol,
            E.map(symbol => makeCompileTimeObject(node, symbol, { loadOps: [] }))
        )
    }

    const typeNode = node.getTypeNode();
    if (tsm.Node.isTypeLiteral(typeNode)) {
        const members = typeNode.getMembers();
        return parseInterfaceMembers(node, members);
    }

    return E.left(makeParseError(node)('parseTypeAliasDecl not supported for this type alias'));
}

export function parseInterfaceDecl(node: tsm.InterfaceDeclaration) {

    const members = pipe(
        node.getType(),
        TS.getTypeProperties,
        ROA.chain(s => s.getDeclarations() as tsm.TypeElementTypes[]),
    )
    return parseInterfaceMembers(node, members);
}

export function makeParseMethodCall(callOp: Operation): ScopedNodeFunc<tsm.CallExpression> {
    return (scope) => (node) => {
        return pipe(
            node,
            parseMethodCallExpression(scope),
            E.map(ROA.append(callOp))
        )
    }
}

export function makeMembers(node: tsm.InterfaceDeclaration, members: Record<string, (sig: tsm.PropertySignature | tsm.MethodSignature, symbol: tsm.Symbol) => CompileTimeObject>) {
    const { left: errors, right: props } = pipe(
        members,
        ROR.collect(StringOrd)((key, value) => {
            return pipe(
                node,
                TS.getMember(key),
                O.bindTo('sig'),
                O.bind('symbol', ({ sig }) => TS.getSymbol(sig)),
                O.map(({ sig, symbol }) => value(sig, symbol)),
                E.fromOption(() => key)
            );
        }),
        ROA.separate
    );

    if (errors.length > 0) throw new CompileError(`unresolved ReadonlyStorageContext interface members: ${errors.join(', ')}`, node);
    return props;
}