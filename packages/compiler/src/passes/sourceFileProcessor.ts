import * as tsm from "ts-morph";
import { identity, pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';

import { CompiledProject, ContractEvent, ContractMethod, ContractVariable } from "../types/CompileOptions";
import { Operation } from "../types/Operation";
import { CompileTimeObject, Scope } from "../types/CompileTimeObject";
import { makeParseError, ParseError, makeParseDiagnostic, updateContextErrors, getScratchFile } from "../utils";
import { hoistDeclarations } from "./hoistDeclarations";
import { parseContractMethod } from "./functionProcessor";
import { generateStoreOps, parseVariableDeclaration, updateDeclarationScope } from "./parseVariableBinding";
import { parseExpression } from "./expressionProcessor";

function reduceFunctionDeclaration(context: ParseSourceContext, node: tsm.FunctionDeclaration): ParseSourceContext {
    if (node.hasDeclareKeyword()) {
        return pipe(
            node,
            TS.getTag("event"),
            E.fromOption(() => makeParseError(node)('only @event declare functions supported')),
            E.chain(() => pipe(node, TS.parseSymbol)),
            E.map(symbol => ({ symbol, node } as ContractEvent)),
            E.match(
                updateContextErrors(context),
                event => ({ ...context, events: ROA.append(event)(context.events) })
            )
        )
    }

    return pipe(
        node,
        parseContractMethod(context.scope),
        E.match(
            updateContextErrors(context),
            method => ({ ...context, methods: ROA.append(method)(context.methods) })
        )
    )
}


export function reduceVariableDeclaration(
    context: ParseSourceContext,
    node: tsm.VariableDeclaration,
    kind: tsm.VariableDeclarationKind
): ParseSourceContext {

    return pipe(
        node.getInitializer(),
        O.fromNullable,
        O.map(parseExpression(context.scope)),
        O.getOrElse(() => E.of(ROA.empty as readonly Operation[])),
        E.mapLeft(ROA.of),
        E.bindTo('initOps'),
        E.bind('parsedVariables', ({ initOps }) => parseVariableDeclaration(node, kind)(initOps)),
        E.match(
            errors => updateContextErrors(context)(errors),
            ({ initOps, parsedVariables }) => {
                const [ scope, variables ] = updateDeclarationScope(parsedVariables, context.scope, ctoFactory);
                return pipe(
                    variables,
                    ROA.map(c => ({ node: c.cto.node, getStoreOps: c.cto.storeOps, index: c.index })),
                    generateStoreOps,
                    E.map(storeOps => {
                        const initializeOps = pipe(
                            context.initializeOps,
                            ROA.concat(initOps),
                            ROA.concat(storeOps)
                        );
                        const staticVars = pipe(
                            context.staticVars,
                            ROA.concat(pipe(
                                variables,
                                ROA.mapWithIndex((index, v) => <ContractVariable>{
                                    name: v.name,
                                    type: v.cto.node.getType(),
                                    index: index + context.staticVars.length
                                }),
                            ))
                        )
                        return <ParseSourceContext>{
                            ...context,
                            scope,
                            staticVars,
                            initializeOps
                        };
                    }),
                    E.match(updateContextErrors(context), identity)
                )

                function ctoFactory(node: tsm.Identifier, symbol: tsm.Symbol, index: number): CompileTimeObject {
                    const slotIndex = index + context.staticVars.length;
                    const loadOps = ROA.of(<Operation>{ kind: "loadstatic", index: slotIndex });
                    const storeOps = ROA.of(<Operation>{ kind: "storestatic", index: slotIndex });
                    return <CompileTimeObject>{ node, symbol, loadOps, storeOps };
                }
            }
        )
    );
}

export interface ParseSourceContext extends CompiledProject {
    readonly initializeOps: readonly Operation[];
    readonly errors: readonly ParseError[];
    readonly scope: Scope;
}

function reduceSourceFileNode(context: ParseSourceContext, node: tsm.Node): ParseSourceContext {

    switch (node.getKind()) {
        case tsm.SyntaxKind.EmptyStatement:
        case tsm.SyntaxKind.EndOfFileToken:
            return context;
        case tsm.SyntaxKind.EnumDeclaration:
        case tsm.SyntaxKind.InterfaceDeclaration:
        case tsm.SyntaxKind.TypeAliasDeclaration:
            // enums, interfaces, and type aliases are processed during hoisting
            return context;
        case tsm.SyntaxKind.FunctionDeclaration:
            return reduceFunctionDeclaration(context, node as tsm.FunctionDeclaration);
        case tsm.SyntaxKind.VariableStatement: {
            const varStmt = node as tsm.VariableStatement;
            const kind = varStmt.getDeclarationKind();
            for (const decl of varStmt.getDeclarations()) {
                context = reduceVariableDeclaration(context, decl, kind);
            }
            return context;
        }
        default: {
            return pipe(
                `reduceSourceFileNode unsupported ${node.getKindName()}`,
                makeParseError(node),
                updateContextErrors(context)
            );
        }
    }
}


const reduceSourceFile =
    (context: ParseSourceContext, node: tsm.SourceFile): ParseSourceContext => {

        return pipe(
            node,
            hoistDeclarations(context.scope),
            E.map(scope => {
                return pipe(
                    node,
                    TS.getChildren,
                    ROA.reduce(<ParseSourceContext>{ ...context, scope }, reduceSourceFileNode)
                )
            }),
            E.match(
                updateContextErrors(context),
                identity
            )
        )
    }

export const parseProject =
    (project: tsm.Project) =>
        (globalScope: Scope): S.State<readonly tsm.ts.Diagnostic[], CompiledProject> =>
            (diagnostics) => {

                const ctx: ParseSourceContext = {
                    scope: globalScope,
                    errors: [],
                    events: [],
                    initializeOps: [],
                    methods: [],
                    staticVars: [],
                }

                const { errors, events, initializeOps, methods, staticVars } = pipe(
                    project.getSourceFiles(),
                    ROA.filter(src => !src.isDeclarationFile()),
                    ROA.reduce(ctx, reduceSourceFile)
                );

                if (ROA.isNonEmpty(staticVars)) {

                    // if there are any static variables, we need to generate an _initialize function
                    // to declare them + execute any initialization code needed

                    const operations = pipe(
                        initializeOps,
                        ROA.prepend<Operation>({ kind: "initstatic", count: staticVars.length }),
                        ROA.append<Operation>({ kind: "return" })
                    );

                    const scratch = getScratchFile(project);
                    const initFunc: tsm.FunctionDeclaration = scratch.addFunction({
                        name: "_initialize",
                        parameters: [],
                        returnType: "void",
                        isExported: true
                    })

                    const [$errors, $methods] = pipe(
                        initFunc,
                        TS.parseSymbol,
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
                            error => ([ROA.append(error)(errors) as readonly ParseError[], methods] as const),
                            method => ([errors, ROA.append(method)(methods)] as const)
                        )
                    );

                    return [
                        { events, methods: $methods, staticVars },
                        ROA.concat(ROA.map(makeParseDiagnostic)($errors))(diagnostics)
                    ]
                } else {
                    return [
                        { events, methods, staticVars },
                        ROA.concat(ROA.map(makeParseDiagnostic)(errors))(diagnostics)
                    ];
                }
            }

