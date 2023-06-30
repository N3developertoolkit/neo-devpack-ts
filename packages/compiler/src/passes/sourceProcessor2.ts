import * as tsm from "ts-morph";
import { identity, pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as SEP from 'fp-ts/Separated';
import { CallInvokeResolver, CompileTimeObject, PropertyResolver, Scope, createScope, parseArguments, updateScope } from "../types/CompileTimeObject";
import { CompileError, ParseError, makeParseError, makeReadOnlyMap, single } from "../utils";
import { Operation, pushInt, pushString } from "../types/Operation";
import { parseExpression } from "./expressionProcessor";
import { ContractVariable } from "../types/CompileOptions";

function parseEnum(node: tsm.EnumDeclaration): E.Either<ParseError, CompileTimeObject> {
    if (!node.isConstEnum()) return E.left(makeParseError(node)("enum must be const"));

    return pipe(
        node.getMembers(),
        ROA.map(member => {
            return pipe(
                E.Do,
                E.bind('symbol', () => pipe(member, TS.parseSymbol)),
                E.bind('op', () => pipe(
                    member,
                    TS.getEnumValue,
                    E.map(value => typeof value === 'number' ? pushInt(value) : pushString(value)),
                    E.mapLeft(makeParseError(member))
                )),
                E.map(({ op, symbol }) => {
                    const resolver: PropertyResolver = () => E.of(<CompileTimeObject>{ node: member, symbol, loadOps: [op] });
                    return [symbol.getName(), resolver] as const;
                })
            )
        }),
        ROA.sequence(E.Applicative),
        E.map(makeReadOnlyMap),
        E.bindTo('properties'),
        E.bind('symbol', () => pipe(node, TS.parseSymbol)),
        E.map(({ properties, symbol }) => <CompileTimeObject>{ node, symbol, loadOps: [], properties }),
    )
}

function parseFunctionDeclaration(node: tsm.FunctionDeclaration): E.Either<ParseError, CompileTimeObject> {
    const paramCount = node.getParameters().length;

    if (node.hasDeclareKeyword()) {
        return pipe(
            node,
            TS.getTag("event"),
            O.chain(tag => O.fromNullable(tag.getCommentText())),
            O.alt(() => pipe(node, TS.getSymbol, O.map(symbol => symbol.getName()))),
            E.fromOption(() => makeParseError(node)("only @event declare functions supported")),
            E.bindTo('eventName'),
            E.bind('symbol', () => pipe(node, TS.parseSymbol)),
            E.map(({ eventName, symbol }) => {
                const call: CallInvokeResolver = (node) => (_$this, args) => {
                    return pipe(
                        args,
                        parseArguments(paramCount),
                        E.map(ROA.concat<Operation>([
                            pushInt(args.length),
                            { kind: 'packarray' },
                            pushString(eventName),
                            { kind: 'syscall', name: "System.Runtime.Notify" }
                        ])),
                        E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                    );
                };
                return <CompileTimeObject>{ node, symbol, loadOps: [], call };
            })
        );
    } else {
        return pipe(
            node,
            TS.parseSymbol,
            E.map(symbol => {
                const call: CallInvokeResolver = (node) => ($this, args) => {
                    return pipe(
                        args,
                        parseArguments(paramCount),
                        E.map(ROA.append<Operation>({ kind: 'call', method: symbol })),
                        E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                    );
                };
                return <CompileTimeObject>{ node, symbol, loadOps: [], call };
            })
        );
    }
}

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}

// convert variable declarations that are compile time constants into CTOs.
// not compile time const variables are returned as part of the second Either for further processing
function parseVarDeclConsts(scope: Scope) {
    return (node: tsm.VariableDeclaration): E.Either<ParseError, E.Either<tsm.VariableDeclaration, CompileTimeObject>> => {
        const kind = node.getVariableStatement()?.getDeclarationKind();
        if (kind !== undefined && kind === tsm.VariableDeclarationKind.Const) {
            return E.of(E.left(node));
        }
        if (!tsm.Node.isIdentifier(node.getNameNode())) {
            return E.of(E.left(node));
        }
        return pipe(
            node.getInitializer(),
            E.fromNullable(makeParseError(node)("const declaration must have initializer")),
            E.chain(parseExpression(scope)),
            E.map(ROA.filter(op => op.kind !== 'noop')),
            E.map(single),
            E.map(O.chain(O.fromPredicate(isPushOp))),
            E.bindTo('initOp'),
            E.bind('symbol', () => pipe(node, TS.parseSymbol)),
            E.map(({ initOp, symbol }) => {
                return pipe(
                    initOp,
                    O.map(op => <CompileTimeObject>{ node: node, symbol, loadOps: [op] }),
                    O.match(() => E.left(node), E.right)
                )
            })
        )
    }
}

function parseSourceFile(node: tsm.SourceFile, globalScope: Scope) {

    let errors: readonly ParseError[] = [];
    const interfaces = node.getInterfaces();
    if (interfaces.length > 0) {
        const error = makeParseError(interfaces[0])("Interfaces not implemented");
        errors = ROA.append(error)(errors);
    }

    const typeAliases = node.getTypeAliases();
    if (typeAliases.length > 0) {
        const error = makeParseError(typeAliases[0])("Type aliases not implemented");
        errors = ROA.append(error)(errors);
    }

    const enums = pipe(
        node.getEnums(),
        ROA.map(E.fromPredicate(
            decl => decl.isConstEnum(),
            decl => makeParseError(decl)('non-const enums not supported')
        )),
        ROA.map(E.chain(parseEnum)),
        ROA.separate
    )
    errors = ROA.concat(enums.left)(errors);

    const functions = pipe(
        node.getFunctions(),
        ROA.map(parseFunctionDeclaration),
        ROA.separate
    )
    errors = ROA.concat(functions.left)(errors);

    let scope = createScope(globalScope)(pipe(enums.right, ROA.concat(functions.right)));

    // parse variable declarations to find compile time constants
    let parsedVars = pipe(
        node.getVariableDeclarations(),
        ROA.map(parseVarDeclConsts(scope)),
        ROA.separate,
        SEP.map(ROA.separate),
    )
    errors = pipe(errors, ROA.concat(parsedVars.left));
    scope = updateScope(scope)(parsedVars.right.right);

    const vars = parsedVars.right.left;
    if (vars.length > 0) {
        const error = makeParseError(vars[0])("non const variables not implemented");
        errors = ROA.append(error)(errors);
    }

    const func2 = pipe(
        node.getFunctions(),
        ROA.filter(node => !node.hasDeclareKeyword()),
    )


}