import * as tsm from "ts-morph";
import { identity, pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as S from 'fp-ts/State';
import * as O from 'fp-ts/Option';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';

import { CompiledProject, ContractEvent, ContractMethod, ContractSlot } from "../types/CompileOptions";
import { Operation, pushInt, pushString, updateLocation } from "../types/Operation";
import { CompileTimeObject, Scope, updateScope } from "../types/CompileTimeObject";
import { makeParseError, ParseError, makeParseDiagnostic, updateContextErrors, getScratchFile, CompileError } from "../utils";
import { hoistDeclarations } from "./hoistDeclarations";
import { parseContractMethod } from "./functionDeclarationProcessor";
import { parseVariableBinding } from "./parseVariableBinding";
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
        O.match(
            () => E.of(ROA.empty),
            init => pipe(
                init,
                parseExpression(context.scope)
            )
        ),
        E.bindTo('initOps'),
        E.mapLeft(ROA.of),
        E.bind('vars', ({ initOps }) => parseVariableBinding(node, kind, initOps)),
        E.match(
            errors => updateContextErrors(context)(errors),
            ({ initOps, vars }) => {
                // create CTOs for all the constant declarations and add them to the scope
                let scope = pipe(
                    vars,
                    ROA.filter(v => !!v.constant),
                    ROA.map(v => <CompileTimeObject>{ node: v.node, symbol: v.symbol, loadOps: [v.constant] }),
                    updateScope(context.scope)
                );

                // create ContractSlots and CTOs for all the non-constant declarations
                const variables = pipe(
                    vars,
                    ROA.filter(v => !v.constant),
                    ROA.mapWithIndex((index, v) => {
                        const slotVar = <ContractSlot>{ name: v.symbol.getName(), type: v.node.getType() };

                        const slotIndex = index + context.staticVars.length;
                        const loadOps = ROA.of(<Operation>{ kind: "loadstatic", index: slotIndex });
                        const storeOps = ROA.of(<Operation>{ kind: "storestatic", index: slotIndex });
                        const cto = <CompileTimeObject>{ node: v.node, symbol: v.symbol, loadOps, storeOps };

                        return [slotVar, cto, v.index] as const;
                    })
                );
                if (!ROA.isNonEmpty(variables))
                    return { ...context, scope };

                // add the variable CTOs to the scope
                scope = updateScope(context.scope)(variables.map(([_, cto]) => cto));

                // add the contract slots to the array of static variables
                const staticVars = pipe(
                    variables,
                    ROA.map(([slotVar]) => slotVar),
                    vars => ROA.concat(vars)(context.staticVars)
                );

                const pickOps = pipe(
                    variables,
                    RNEA.matchRight(
                        (init, [_, lastCTO, lastIndex]) => {
                            return pipe(
                                init,
                                ROA.map(([_, cto, index]) => pipe(
                                    makePickOps(cto, index),
                                    ROA.prepend<Operation>({ kind: "duplicate", location: cto.node })
                                )),
                                ROA.flatten<Operation>, ROA.concat(pipe(
                                    makePickOps(lastCTO, lastIndex),
                                    updateLocation(lastCTO.node)
                                ))
                            );
                        }
                    )
                );

                const initializeOps = [...context.initializeOps, ...initOps, ...pickOps];
                return { ...context, scope, staticVars, initializeOps };

                function makePickOps(cto: CompileTimeObject, index: string | number | undefined): readonly Operation[] {
                    if (!cto.storeOps)
                        throw new CompileError('unexpected missing storeOps', cto.node);
                    if (!index)
                        return cto.storeOps;
                    const indexOp = typeof index === 'number' ? pushInt(index) : pushString(index);
                    return [indexOp, { kind: 'pickitem' }, ...cto.storeOps];
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

        // let { staticVars } = context;

        // const varFactory = ($var: HoistedVariable): CompileTimeObject => {
        //     const index = staticVars.length;
        //     staticVars = ROA.append({ name: $var.symbol.getName(), type: $var.type })(staticVars);

        //     // Specifying storeOps, even if the hoisted variable is const.
        //     // TS will fail any attempt to write to a const variable, so we don't need to worry about it.
        //     // We need storeOps to correctly write the variable initialization 
        //     const loadOps = ROA.of(<Operation>{ kind: "loadstatic", index });
        //     const storeOps = ROA.of(<Operation>{ kind: "storestatic", index });
        //     return { node: $var.node, symbol: $var.symbol, loadOps, storeOps };
        // }

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

