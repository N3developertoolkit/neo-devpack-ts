import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from '../TS';
import * as E from "fp-ts/Either";

import { flow, identity, pipe } from "fp-ts/function";
import { CompiledProject, CompilerState, ContractEvent, ContractMethod, ContractSlot } from "../types/CompileOptions";
import { parseContractMethod } from "./functionDeclarationProcessor";
import { handleVariableStatement } from "./variableStatementProcessor";
import { Operation } from "../types/Operation";
import { updateScopeSymbols, createEmptyScope } from "../scope";
import { Scope, SymbolDef } from "../types/ScopeType";
import { parseSymbol } from "./parseSymbol";
import { EventFunctionSymbolDef as EventSymbolDef, LocalFunctionSymbolDef as FunctionSymbolDef, StaticVarSymbolDef } from "./sourceSymbolDefs";
import { makeParseError, ParseError, makeParseDiagnostic } from "../utils";

const hoistFunctionDeclaration =
    (context: HoistContext, node: tsm.FunctionDeclaration): HoistContext => {
        if (node.hasDeclareKeyword()) {
            return pipe(
                node,
                TS.getTag("event"),
                E.fromOption(() => makeParseError(node)('only @event declare functions supported')),
                E.chain(tag => EventSymbolDef.create(node, tag)),
                hoist
            );
        } else {
            return pipe(
                node,
                FunctionSymbolDef.create,
                hoist
            );
        }

        function hoist(def: E.Either<ParseError, SymbolDef>): HoistContext {
            return pipe(
                def,
                E.chain(flow(
                    updateScopeSymbols(context.scope),
                    E.mapLeft(makeParseError(node))
                )),
                E.match(
                    error => ({ ...context, errors: ROA.append(makeParseError(node)(error))(context.errors) }),
                    scope => ({ ...context, scope }),
                )
            );
        }
    }

function hoistDeclaration(context: HoistContext, node: tsm.Node): HoistContext {

    switch (node.getKind()) {
        case tsm.SyntaxKind.FunctionDeclaration:
            return hoistFunctionDeclaration(context, node as tsm.FunctionDeclaration);
        default:
            return context;
    }
}

interface HoistContext {
    readonly errors: readonly ParseError[];
    readonly scope: Scope;
}

const hoistDeclarations =
    (parentScope: Scope) =>
        (node: tsm.Node): E.Either<readonly ParseError[], Scope> => {

            return pipe(
                node,
                TS.getChildren,
                ROA.reduce({
                    errors: [],
                    scope: createEmptyScope(parentScope)
                }, hoistDeclaration),
                ({ scope, errors }) => errors.length > 0 ? E.left(errors) : E.of(scope)
            )
        }


function reduceFunctionDeclaration(context: ParseDeclarationsContext, node: tsm.FunctionDeclaration): ParseDeclarationsContext {
    const makeError = makeParseError(node);
    if (node.hasDeclareKeyword()) {
        return pipe(
            node,
            TS.getTag("event"),
            E.fromOption(() => makeError('only @event declare functions supported')),
            E.chain(() => pipe(node, parseSymbol)),
            E.map(symbol => ({ symbol, node } as ContractEvent)),
            E.match(
                error => ({ ...context, errors: ROA.append(error)(context.errors) } as ParseDeclarationsContext),
                event => ({ ...context, events: ROA.append(event)(context.events) })
            )
        )
    }

    return pipe(
        node,
        parseContractMethod(context.scope),
        E.match(
            errors => ({ ...context, errors: ROA.concat(errors)(context.errors) } as ParseDeclarationsContext),
            method => ({ ...context, methods: ROA.append(method)(context.methods) })
        )
    )
}

function reduceVariableStatement(context: ParseDeclarationsContext, node: tsm.VariableStatement): ParseDeclarationsContext {

    const factory = (element: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) =>
        new StaticVarSymbolDef(element, symbol, index + context.staticVars.length);

    return pipe(
        node,
        handleVariableStatement(context.scope)(factory),
        E.match(
            errors => {
                return { ...context, errors: ROA.concat(errors)(context.errors) };
            },
            ([scope, defs, ops]) => {
                const staticVars = pipe(
                    defs,
                    ROA.map(d => ({ name: d.symbol.getName(), type: d.type } as ContractSlot)),
                    vars => ROA.concat(vars)(context.staticVars)
                )
                const initializeOps = ROA.concat(context.initializeOps)(ops);
                return { ...context, scope, staticVars, initializeOps } as ParseDeclarationsContext;
            }
        )
    )
}

interface ParseSourceContext extends CompiledProject {
    readonly initializeOps: readonly Operation[];
    readonly errors: readonly ParseError[];
}
interface ParseDeclarationsContext extends ParseSourceContext {
    readonly scope: Scope;
}

function reduceDeclaration(context: ParseDeclarationsContext, node: tsm.Node): ParseDeclarationsContext {

    switch (node.getKind()) {
        // ignore empty statements and the end of file token
        case tsm.SyntaxKind.EmptyStatement:
        case tsm.SyntaxKind.EndOfFileToken:
            return context;
        // type aliases and interfaces are processed during hoisting
        case tsm.SyntaxKind.InterfaceDeclaration:
        case tsm.SyntaxKind.TypeAliasDeclaration:
            return context;
        case tsm.SyntaxKind.FunctionDeclaration:
            return reduceFunctionDeclaration(context, node as tsm.FunctionDeclaration);
        case tsm.SyntaxKind.VariableStatement:
            return reduceVariableStatement(context, node as tsm.VariableStatement);
    }

    const error = makeParseError(node)(`parseSourceNode ${node.getKindName()} not impl`);
    return { ...context, errors: ROA.append(error)(context.errors) };
}

const reduceSourceFile =
    (scope: Scope) =>
        (ctx: ParseSourceContext, src: tsm.SourceFile): ParseSourceContext => {
            return pipe(
                src,
                hoistDeclarations(scope),
                E.map(scope => {
                    return pipe(
                        src,
                        TS.getChildren,
                        ROA.reduce({ ...ctx, scope }, reduceDeclaration)
                    )
                }),
                E.match(
                    errors => ({ ...ctx, errors: ROA.concat(errors)(ctx.errors) }),
                    identity
                )
            )
        }

export const parseProject =
    (project: tsm.Project) =>
        (scope: Scope): CompilerState<CompiledProject> =>
            (diagnostics) => {

                const ctx: ParseSourceContext = {
                    errors: [],
                    events: [],
                    initializeOps: [],
                    methods: [],
                    staticVars: [],
                }

                const result = pipe(
                    project.getSourceFiles(),
                    ROA.filter(src => !src.isDeclarationFile()),
                    ROA.reduce(ctx, reduceSourceFile(scope))
                );
                const { events, initializeOps, staticVars } = result
                let { errors, methods } = result;
                if (ROA.isNonEmpty(staticVars)) {

                    const operations = pipe(
                        initializeOps,
                        ROA.prepend({ kind: "initstatic", count: staticVars.length } as Operation),
                        ROA.append({ kind: "return" } as Operation)
                    );

                    const initSrc = project.createSourceFile("initialize.ts");
                    const initFunc = initSrc.addFunction({
                        name: "_initialize",
                        parameters: [],
                        returnType: "void",
                        isExported: true
                    })

                    const { errors: $errors, methods: $methods } = pipe(
                        initFunc,
                        parseSymbol,
                        E.map(symbol => {
                            return {
                                name: symbol.getName(),
                                node: initFunc,
                                symbol,
                                operations,
                                variables: []
                            } as ContractMethod
                        }),
                        E.match(
                            error => ({ errors: ROA.append(error)(errors) as readonly ParseError[], methods }),
                            method => ({ methods: ROA.append(method)(methods), errors })
                        )
                    );
                    errors = $errors;
                    methods = $methods;
                }

                return [
                    { events, methods, staticVars },
                    ROA.concat(errors.map(makeParseDiagnostic))(diagnostics)
                ];
            }

