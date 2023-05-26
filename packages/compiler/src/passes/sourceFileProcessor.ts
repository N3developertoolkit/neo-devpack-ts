import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as S from 'fp-ts/State';

import { flow, identity, pipe } from "fp-ts/function";
import { CompiledProject, ContractEvent, ContractMethod, ContractSlot } from "../types/CompileOptions";
import { parseContractMethod } from "./functionDeclarationProcessor";
import { handleVariableStatement } from "./variableStatementProcessor";
import { Operation } from "../types/Operation";
import { Scope, CompileTimeObject, createEmptyScope, updateScope, CompileTimeType } from "../types/CompileTimeObject";
import { makeParseError, ParseError, makeParseDiagnostic, ReduceDispatchMap, dispatchReduce, updateContextErrors } from "../utils";
import { makeStaticVariable, parseEnumDecl, parseFunctionDecl, parseInterfaceDecl, parseTypeAliasDecl } from "./parseDeclarations";


const hoist =
    (context: HoistContext, node: tsm.Node, func: (scope: Scope, cto: CompileTimeObject) => E.Either<string, Scope>) =>
        (def: E.Either<ParseError, CompileTimeObject>): HoistContext => {
            return pipe(
                def,
                E.chain(flow(
                    cto => func(context.scope, cto),
                    E.mapLeft(makeParseError(node))
                )),
                E.match(
                    updateContextErrors(context),
                    scope => ({ ...context, scope }),
                )
            );
        }

// // TODO: remove E.Either
// function hoistSymbol(scope: Scope, cto: CompileTimeObject): E.Either<string, Scope> {
//     return E.of(updateScope(scope)(cto));
// }

// function hoistType(scope: Scope, cto: CompileTimeType): E.Either<string, Scope> {
//     return E.of(updateScope(scope)(undefined, cto));
// }

function hoistDeclaration(context: HoistContext, node: tsm.Node): HoistContext {
    throw new Error('disabled');
    // return context;

    // switch (node.getKind()) {
    //     case tsm.SyntaxKind.InterfaceDeclaration:
    //         return pipe(node as tsm.InterfaceDeclaration, parseInterfaceDecl, hoist(context, node, hoistType));
    //     case tsm.SyntaxKind.TypeAliasDeclaration:
    //         return pipe(node as tsm.TypeAliasDeclaration, parseTypeAliasDecl, hoist(context, node, hoistType));
    //     case tsm.SyntaxKind.FunctionDeclaration:
    //         return pipe(node as tsm.FunctionDeclaration, parseFunctionDecl, hoist(context, node, hoistSymbol));
    //     default:
    //         return context;
    // }
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

function reduceVariableStatement(context: ParseDeclarationsContext, node: tsm.VariableStatement): ParseDeclarationsContext {

    return pipe(
        node,
        handleVariableStatement(context.scope)(makeStaticVariable),
        E.match(
            updateContextErrors(context),
            ([scope, vars, ops]) => {
                const staticVars = ROA.concat(vars)(context.staticVars);
                const initializeOps = ROA.concat(context.initializeOps)(ops);
                return { ...context, scope, staticVars, initializeOps } as ParseDeclarationsContext;
            }
        )
    )
}

function reduceEnumDeclaration(context: ParseDeclarationsContext, node: tsm.EnumDeclaration): ParseDeclarationsContext {
    throw new Error('disabled');
    // return context;
    // return pipe(
    //     node,
    //     parseEnumDecl,
    //     E.chain(flow(
    //         updateScope(context.scope),
    //         E.mapLeft(makeParseError(node))
    //     )),
    //     E.match(
    //         updateContextErrors(context),
    //         scope => ({ ...context, scope })
    //     )
    // )
}


interface ParseSourceContext extends CompiledProject {
    readonly initializeOps: readonly Operation[];
    readonly errors: readonly ParseError[];
}
interface ParseDeclarationsContext extends ParseSourceContext {
    readonly scope: Scope;
}

const dispatchMap: ReduceDispatchMap<ParseDeclarationsContext> = {
    [tsm.SyntaxKind.EmptyStatement]: (context, _node) => context,
    [tsm.SyntaxKind.EndOfFileToken]: (context, _node) => context,
    [tsm.SyntaxKind.EnumDeclaration]: reduceEnumDeclaration,
    [tsm.SyntaxKind.FunctionDeclaration]: reduceFunctionDeclaration,
    [tsm.SyntaxKind.InterfaceDeclaration]: (context, _node) => context,
    [tsm.SyntaxKind.TypeAliasDeclaration]: (context, _node) => context,
    [tsm.SyntaxKind.VariableStatement]: reduceVariableStatement,
}

const reduceDeclaration = dispatchReduce("reduceDeclaration", dispatchMap);

const reduceSourceFile =
    (scope: Scope) =>
        (context: ParseSourceContext, node: tsm.SourceFile): ParseSourceContext => {
            return pipe(
                node,
                hoistDeclarations(scope),
                E.map(scope => {
                    return pipe(
                        node,
                        TS.getChildren,
                        ROA.reduce({ ...context, scope }, reduceDeclaration)
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
                    errors: [],
                    events: [],
                    initializeOps: [],
                    methods: [],
                    staticVars: [],
                }

                const result = pipe(
                    project.getSourceFiles(),
                    ROA.filter(src => !src.isDeclarationFile()),
                    ROA.reduce(ctx, reduceSourceFile(globalScope))
                );
                const { events, initializeOps: initOps, staticVars } = result
                let { errors, methods } = result;

                if (ROA.isNonEmpty(staticVars)) {

                    const operations = pipe(
                        initOps,
                        ROA.prepend<Operation>({ kind: "initstatic", count: staticVars.length }),
                        ROA.append<Operation>({ kind: "return" })
                    );

                    const scratch = project.getSourceFile("scratch.ts") || project.createSourceFile("scratch.ts");
                    const initFunc: tsm.FunctionDeclaration = scratch.addFunction({
                        name: "_initialize",
                        parameters: [],
                        returnType: "void",
                        isExported: true
                    })

                    // using [errors, methods] as LHS of assignment creates a strange TS error that claims
                    // we are using initFunc (below) before it is declared (above). Using a temp variable
                    // to avoid this error
                    const result = pipe(
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
                    [errors, methods] = result;
                }

                return [
                    { events, methods, staticVars },
                    ROA.concat(ROA.map(makeParseDiagnostic)(errors))(diagnostics)
                ];
            }

