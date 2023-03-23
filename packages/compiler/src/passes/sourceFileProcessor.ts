import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from '../utility/TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'

import { flow, identity, pipe } from "fp-ts/function";
import { CompiledProject, CompilerState, ContractEvent, ContractSlot } from "../types/CompileOptions";
import { makeParseDiagnostic, makeParseError, } from "../symbolDef";
import { parseContractMethod } from "./functionDeclarationProcessor";
import { parseExpression } from './expressionProcessor';
import { Operation } from "../types/Operation";
import { updateScopeSymbols, updateScopeTypes, createEmptyScope } from "../scope";
import { ParseError, Scope, SymbolDef, TypeDef } from "../types/ScopeType";
import { parseSymbol } from "./parseSymbol";
import { createDiagnostic, single } from "../utils";
import { ConstantSymbolDef, EventFunctionSymbolDef as EventSymbolDef, LocalFunctionSymbolDef as FunctionSymbolDef, StaticVarSymbolDef, StructMemberSymbolDef, StructSymbolDef } from "./sourceSymbolDefs";

const handleHoistResult =
    <T extends SymbolDef | TypeDef>(node: tsm.Node, context: HoistContext, func: (def: T) => E.Either<string, Scope>) =>
        (def: E.Either<ParseError, T>): HoistContext => {
            return pipe(
                def,
                E.chain(flow(func, E.mapLeft(makeParseError(node)))),
                E.match(
                    error => ({ ...context, errors: ROA.append(error)(context.errors ?? []) }),
                    scope => ({ ...context, scope }),
                )
            )
        }

const hoistFunctionDeclaration =
    (context: HoistContext, node: tsm.FunctionDeclaration): HoistContext => {
        const updateScope = (d: SymbolDef) => updateScopeSymbols(context.scope)(d);
        if (node.hasDeclareKeyword()) {
            return pipe(
                node,
                TS.getTag("event"),
                E.fromOption(() => makeParseError(node)('only @event declare functions supported')),
                E.chain(tag => EventSymbolDef.create(node, tag)),
                handleHoistResult(node, context, updateScope)
            )
        } else {
            return pipe(
                node,
                FunctionSymbolDef.create,
                handleHoistResult(node, context, updateScope)
            );
        }

        return context;
    }

const hoistInterfaceDeclaration =
    (context: HoistContext, node: tsm.InterfaceDeclaration): HoistContext => {
        const updateScope = (d: TypeDef) => updateScopeTypes(context.scope)(d);
        if (TS.hasTag("struct")(node)) {
            return pipe(
                node,
                TS.getType,
                TS.getTypeProperties,
                ROA.mapWithIndex((index, symbol) => {
                    return pipe(
                        symbol.getDeclarations(),
                        single,
                        O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
                        O.map(sig => new StructMemberSymbolDef(sig, index)),
                        E.fromOption(() => `${symbol.getName()} invalid struct property`));
                }),
                ROA.separate,
                ({ left: errors, right: members }) => {
                    return errors.length > 0
                        ? E.left<ParseError, readonly SymbolDef[]>(makeParseError(node)(errors.join(", ")))
                        : E.of<ParseError, readonly SymbolDef[]>(members);
                },
                E.map(props => {
                    return new StructSymbolDef(node, props);
                }),
                handleHoistResult(node, context, updateScope)
            );
        }
        return context;
    }

interface HoistContext {
    readonly scope: Scope;
    readonly errors?: readonly ParseError[];
}

function hoistDeclaration(context: HoistContext, node: tsm.Node): HoistContext {

    if (tsm.Node.isFunctionDeclaration(node)) return hoistFunctionDeclaration(context, node);
    if (tsm.Node.isInterfaceDeclaration(node)) return hoistInterfaceDeclaration(context, node);
    return context;
}

const hoistDeclarations =
    (parentScope: Scope) =>
        (node: tsm.Node): E.Either<readonly ParseError[], Scope> => {

            const { scope, errors } = pipe(
                node,
                TS.getChildren,
                ROA.reduce(
                    { scope: createEmptyScope(parentScope) } as HoistContext,
                    hoistDeclaration
                )
            )
            return errors && errors.length > 0 ? E.left(errors) : E.of(scope);
        }

interface ParseNodeContext extends Partial<CompiledProject> {
    readonly scope: Scope,
    readonly errors?: readonly ParseError[];
}

function addError(context: ParseNodeContext, error: ParseError): ParseNodeContext {
    return { ...context, errors: ROA.append(error)(context.errors ?? []) }
}

function parseFunctionDeclaration(context: ParseNodeContext, node: tsm.FunctionDeclaration): ParseNodeContext {
    const makeError = makeParseError(node);
    if (node.hasDeclareKeyword()) {
        return pipe(
            node,
            TS.getTag("event"),
            E.fromOption(() => makeError('only @event declare functions supported')),
            E.chain(() => pipe(node, parseSymbol)),
            E.map(symbol => ({ symbol, node } as ContractEvent)),
            E.match(
                error => {
                    return { ...context, errors: ROA.append(error)(context.errors ?? []) } as ParseNodeContext
                },
                event => { 
                    return { ...context, events: ROA.append(event)(context.events ?? []) }
                }
            )
        )
    }

    return pipe(
        node,
        parseContractMethod(context.scope),
        E.match(
            errors => {
                return { ...context, errors: ROA.concat(errors)(context.errors ?? []) } as ParseNodeContext
            },
            method => { 
                return { ...context, methods: ROA.append(method)(context.methods ?? []) }
            }
        )
    )
}

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}

function makeStaticVar(node: tsm.VariableDeclaration, symbol: tsm.Symbol, context: ParseNodeContext, initOps?: readonly Operation[]) {
    const staticVarCount = context.staticVars?.length ?? 0;
    const def = new StaticVarSymbolDef(node, symbol, staticVarCount, initOps);
    return pipe(
        def,
        updateScopeSymbols(context.scope),
        E.map(scope => {
            const slot: ContractSlot = { name: def.name, type: def.type };
            return {
                ...context,
                scope,
                staticVars: ROA.append(slot)(context.staticVars ?? [])
            } as ParseNodeContext
        }),
        E.mapLeft(makeParseError(node))
    )
}

function parseConstVariableDeclaration(context: ParseNodeContext, node: tsm.VariableDeclaration): ParseNodeContext {
    const makeError = makeParseError(node);

    return pipe(
        node.getInitializer(),
        E.fromNullable(makeError('const declaration requires initializer')),
        E.chain(parseExpression(context.scope)),
        E.bindTo('initOps'),
        E.bind('symbol', () => parseSymbol(node)),
        E.chain(({ initOps, symbol }) => {
            // if the init expression is a single push operation, register 
            // a constant symbol, which enables the value to be inserted
            // at compile time rather than loaded at runtime. Otherwise,
            // register a static var symbol
            return pipe(
                initOps,
                ROA.filter(op => op.kind != 'noop'),
                single,
                O.chain(O.fromPredicate(isPushOp)),
                O.match(
                    () => makeStaticVar(node, symbol, context, initOps),
                    op => {
                        return pipe(
                            new ConstantSymbolDef(node, symbol, op),
                            updateScopeSymbols(context.scope),
                            E.map(scope => {
                                return { ...context, scope } as ParseNodeContext
                            }),
                            E.mapLeft(makeError),
                        )
                    }
                ),
            )
        }),
        E.match(
            error => ({ ...context, errors: ROA.append(error)(context.errors ?? []) }),
            identity
        )
    )
}

function parseLetVariableDeclaration(context: ParseNodeContext, node: tsm.VariableDeclaration): ParseNodeContext {
    return pipe(
        node.getInitializer(),
        O.fromNullable,
        O.match(
            () => E.of(O.none),
            flow(parseExpression(context.scope), E.map(O.of))
        ),
        E.bindTo('initOps'),
        E.bind('symbol', () => parseSymbol(node)),
        E.chain(({ initOps, symbol }) => {
            return makeStaticVar(node, symbol, context, O.toUndefined(initOps))
        }),
        E.match(
            error => ({ ...context, errors: ROA.append(error)(context.errors ?? []) }),
            identity
        )
    )
}

function parseVariableStatement(context: ParseNodeContext, node: tsm.VariableStatement): ParseNodeContext {
    const declKind = node.getDeclarationKind();
    if (declKind === tsm.VariableDeclarationKind.Var) {
        return addError(context, makeParseError(node)('var declarations not supported'));
    }
    const parseDecl = declKind === tsm.VariableDeclarationKind.Const
        ? parseConstVariableDeclaration
        : parseLetVariableDeclaration;

    for (const decl of node.getDeclarations()) {
        context = parseDecl(context, decl);
    }
    return context;
}

function parseSourceNode(context: ParseNodeContext, node: tsm.Node): ParseNodeContext {
    switch (node.getKind()) {
        case tsm.SyntaxKind.EndOfFileToken:
        case tsm.SyntaxKind.InterfaceDeclaration:
            return context;

        case tsm.SyntaxKind.FunctionDeclaration:
            return parseFunctionDeclaration(context, node as tsm.FunctionDeclaration);
        case tsm.SyntaxKind.VariableStatement:
            return parseVariableStatement(context, node as tsm.VariableStatement);
    }

    const error = makeParseError(node)(`parseSourceNode ${node.getKindName()} not impl`);
    const errors = ROA.append(error)(context.errors ?? []);
    return { ...context, errors };
}

const parseSourceNodes = (node: tsm.Node) => (scope: Scope) => {

    const { errors, events, methods, staticVars } = pipe(
        node,
        TS.getChildren,
        ROA.reduce(
            { scope } as ParseNodeContext,
            parseSourceNode
        )
    )
    return errors && errors.length > 0
        ? E.left(errors)
        : E.of({ events, methods, staticVars } as CompiledProject);

}

const parseSourceFile =
    (parentScope: Scope) => (src: tsm.SourceFile): E.Either<readonly ParseError[], CompiledProject> => {

        return pipe(
            src,
            // hoist all function + type decls so they are available in the entire file scope
            hoistDeclarations(parentScope),
            E.chain(parseSourceNodes(src))
        )
    }

export const parseProject =
    (project: tsm.Project) =>
        (scope: Scope): CompilerState<CompiledProject> =>
            (diagnostics) => {

                return pipe(
                    project.getSourceFiles(),
                    ROA.filter(src => !src.isDeclarationFile()),
                    ROA.map(parseSourceFile(scope)),
                    ROA.separate,
                    ({left, right}) => left.length > 0 ? E.left(ROA.flatten(left)) : E.of(right),
                    E.mapLeft(ROA.map(makeParseDiagnostic)),
                    E.match(
                        diags => {
                            diagnostics = ROA.concat(diags)(diagnostics);
                            return [{ events: [], methods: [], staticVars: [] }, diagnostics]
                        },
                        results => {
                            if (results.length === 1) {
                                return [results[0], diagnostics]
                            }
                            const msg = results.length === 0
                                ? "no compile results found"
                                : "multiple source files not implemented"; 
                            diagnostics = ROA.append(createDiagnostic(msg))(diagnostics);
                            return [{ events: [], methods: [], staticVars: [] }, diagnostics]
                        }
                    )
                );
            }

