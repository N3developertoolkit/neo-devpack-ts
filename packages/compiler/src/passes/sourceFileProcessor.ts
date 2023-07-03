import * as tsm from "ts-morph";
import { flow, identity, pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as SEP from 'fp-ts/Separated';

import { CompiledProject, ContractEvent, ContractMethod, ContractVariable } from "../types/CompileOptions";
import { Operation, isPushOp, pushInt, pushString } from "../types/Operation";
import { CallInvokeResolver, CompileTimeObject, PropertyResolver, Scope, createScope, parseArguments, resolve, updateScope } from "../types/CompileTimeObject";
import { makeParseError, ParseError, makeParseDiagnostic, getScratchFile, CompileError, single, makeReadOnlyMap, E_fromSeparated } from "../utils";
import { parseContractMethods } from "./functionProcessor";
import { ParsedConstant, ParsedVariable, StoreOpVariable, VariableBinding, flattenNestedVaribleBinding, generateStoreOps, isParsedConstant, isVariableBinding, readNestedVariableBinding } from "./parseVariableBinding";
import { parseExpression } from "./expressionProcessor";

interface ParsedSource {
    readonly methods: readonly ContractMethod[];
    readonly events: readonly ContractEvent[];
    readonly staticVars: readonly ContractVariable[];
    readonly initOps: readonly Operation[];
}

export function parseProject(project: tsm.Project) {
    return (globalScope: Scope): S.State<readonly tsm.ts.Diagnostic[], CompiledProject> =>
        (diagnostics) => {
            let errors: readonly ParseError[] = [];
            let methods: readonly ContractMethod[] = [];
            let events: readonly ContractEvent[] = [];
            let staticVars: readonly ContractVariable[] = [];
            let initOps: readonly Operation[] = [];

            pipe(
                project.getSourceFiles(),
                ROA.filter(src => !src.isDeclarationFile()),
                ROA.map(parseSourceFile(globalScope, staticVars.length)),
                ROA.map(
                    E.match(
                        $errors => { errors = ROA.concat($errors)(errors); },
                        $source => {
                            methods = ROA.concat($source.methods)(methods);
                            events = ROA.concat($source.events)(events);
                            staticVars = ROA.concat($source.staticVars)(staticVars);
                            initOps = ROA.concat($source.initOps)(initOps);
                        }
                    )
                )
            );

            // generate _initialize function if there are any static variables
            if (ROA.isNonEmpty(staticVars)) {
                const operations = pipe(
                    initOps,
                    ROA.prepend<Operation>({ kind: "initstatic", count: staticVars.length }),
                    ROA.append<Operation>({ kind: "return" })
                );

                const scratch = getScratchFile(project);
                const initFuncDecl: tsm.FunctionDeclaration = scratch.addFunction({
                    name: "_initialize",
                    parameters: [],
                    returnType: "void",
                    isExported: true
                });

                pipe(
                    scratch.addFunction({
                        name: "_initialize",
                        parameters: [],
                        returnType: "void",
                        isExported: true
                    }),
                    TS.parseSymbol,
                    E.map(symbol => {
                        return {
                            name: symbol.getName(),
                            node: initFuncDecl,
                            symbol,
                            operations,
                            variables: []
                        } as ContractMethod;
                    }),
                    E.match(
                        error => { errors = ROA.append(error)(errors); },
                        method => { methods = ROA.append(method)(methods); }
                    )
                );
            }

            return [
                { events, methods, staticVars },
                ROA.concat(ROA.map(makeParseDiagnostic)(errors))(diagnostics)
            ];
        };
}

function parseSourceFile(globalScope: Scope, staticVarCount: number) {
    return (node: tsm.SourceFile): E.Either<readonly ParseError[], ParsedSource> => {
        // hoist interfaces
        // hoist type aliases

        const { left: constEnumErrors, right: constEnums } = pipe(
            node.getEnums(),
            ROA.filter(e => e.isConstEnum()),
            ROA.map(hoistConstEnumDeclaration),
            ROA.separate,
            SEP.mapLeft(ROA.flatten),
        );

        // hoist event declarations
        const { left: eventErrors, right: events } = pipe(
            node.getFunctions(),
            ROA.filter(f => f.hasDeclareKeyword()),
            ROA.map(hoistEventDeclaration),
            ROA.separate
        );

        // hoist functions
        const { left: functionErrors, right: functions } = pipe(
            node.getFunctions(),
            ROA.filter(f => !f.hasDeclareKeyword()),
            ROA.map(hoistFunctionDeclaration),
            ROA.separate
        );

        // create a scope for the hoisted declarations
        let scope = pipe(
            constEnums,
            ROA.concat(events),
            ROA.concat(functions),
            ctos => createScope(globalScope)(ctos)
        )

        // hoist variables
        const { left: variableErrors, right: { ctos: variables, debugVars: contractStatics } } = pipe(
            node,
            TS.getLocalVariableDeclarations,
            ROA.map(hoistVariableDeclaration(scope)),
            ROA.separate,
            SEP.mapLeft(ROA.flatten),
            SEP.map(flow(
                ROA.flatten,
                hoistParsedVariables(staticVarCount)
            )),
        );

        // if there are any errors created in the hoisting process, return them
        let errors = pipe(
            constEnumErrors,
            ROA.concat(eventErrors),
            ROA.concat(functionErrors),
            ROA.concat(variableErrors)
        );
        if (ROA.isNonEmpty(errors)) return E.left(errors);

        // add variable CTOs to scope
        scope = updateScope(scope)(variables);

        const contractEvents = pipe(
            events,
            ROA.map(cto => {
                if (!cto.symbol) throw new CompileError("Expected event to have symbol", cto.node);
                return <ContractEvent>{ node: cto.node, symbol: cto.symbol }
            })
        );

        let contractMethods: readonly ContractMethod[] = [];
        let initializeOps: readonly Operation[] = [];

        for (const stmt of node.forEachChildAsArray()) {
            switch (stmt.getKind()) {
                // empty statements and the EOF token are ignored
                case tsm.SyntaxKind.EmptyStatement:
                case tsm.SyntaxKind.EndOfFileToken:
                // enums, interfaces, and type aliases are processed during hoisting
                case tsm.SyntaxKind.EnumDeclaration:
                case tsm.SyntaxKind.InterfaceDeclaration:
                case tsm.SyntaxKind.TypeAliasDeclaration:
                    continue;
                case tsm.SyntaxKind.FunctionDeclaration: {
                    const decl = stmt as tsm.FunctionDeclaration;
                    // skip declare functions (i.e. events)
                    if (decl.hasDeclareKeyword()) continue;
                    pipe(
                        decl,
                        parseContractMethods(scope),
                        E.match(
                            $errors => { errors = ROA.concat($errors)(errors) },
                            $methods => { contractMethods = ROA.concat($methods)(contractMethods) }
                        )
                    );
                    break;
                }
                case tsm.SyntaxKind.VariableStatement: {
                    pipe(
                        stmt as tsm.VariableStatement,
                        parseVariableStatement(scope),
                        E.match(
                            $errors => { errors = ROA.concat($errors)(errors) },
                            $ops => { initializeOps = ROA.concat($ops)(initializeOps) }
                        )
                    );
                    break;
                }
                default: {
                    const error = makeParseError(stmt)(`unsupported statement ${stmt.getKindName()}`);
                    errors = ROA.append(error)(errors);
                }
            }
        }

        if (errors.length > 0) return E.left(errors);

        return E.of({
            methods: contractMethods,
            events: contractEvents,
            staticVars: contractStatics,
            initOps: initializeOps
        });
    }
}

function parseVariableStatement(scope: Scope) {
    return (node: tsm.VariableStatement): E.Either<readonly ParseError[], readonly Operation[]> => {
        const kind = node.getDeclarationKind();
        return pipe(
            node.getDeclarations(),
            ROA.map(parseVariableDeclaration(scope, kind)),
            ROA.separate,
            SEP.mapLeft(ROA.flatten),
            SEP.map(ROA.flatten),
            E_fromSeparated
        )
    }
}

function parseVariableDeclaration(scope: Scope, kind: tsm.VariableDeclarationKind) {
    return (node: tsm.VariableDeclaration): E.Either<readonly ParseError[], readonly Operation[]> => {
        const kind = node.getVariableStatement()?.getDeclarationKind();
        return pipe(
            E.Do,
            E.bind("bindings", () => parseVariableBindings(node)),
            E.bind("initOps", () => parseVariableInitializer(scope)(node)),
            E.bind("storeOps", ({ bindings, initOps }) => {
                return pipe(
                    parseBoundVariables(kind)(bindings, initOps),
                    ROA.filterMap(O.fromPredicate(isVariableBinding)),
                    ROA.map(({ node, symbol, index }) => {
                        return pipe(symbol,
                            resolve(scope),
                            E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} symbol`)),
                            E.map(cto => <StoreOpVariable>{ node, index, storeOps: cto.storeOps })
                        )
                    }),
                    ROA.separate,
                    E_fromSeparated,
                    E.chain(flow(generateStoreOps, E.mapLeft(ROA.of)))
                )
            }),
            E.map(({ initOps, storeOps }) => ROA.isEmpty(initOps) || ROA.isEmpty(storeOps)
                ? ROA.empty
                : ROA.concat(storeOps)(initOps)
            )
        )
    }
}

function hoistEventDeclaration(node: tsm.FunctionDeclaration): E.Either<ParseError, CompileTimeObject> {
    if (!node.hasDeclareKeyword()) throw new CompileError("Expected function to have declare keyword", node);
    return pipe(
        node,
        TS.getTag("event"),
        E.fromOption(() => makeParseError(node)("only @event declare functions supported")),
        E.chain(E.fromPredicate(
            () => node.getReturnType().isVoid(),
            () => makeParseError(node)("event functions must return void")
        )),
        E.bindTo("eventTag"),
        E.bind("symbol", () => TS.parseSymbol(node)),
        E.bind("eventName", ({ eventTag, symbol }) => {
            return pipe(
                eventTag.getCommentText(),
                O.fromNullable,
                O.getOrElse(() => symbol.getName()),
                E.of<ParseError, string>
            )
        }),
        E.map(({ symbol, eventName }) => {
            const paramCount = node.getParameters().length;
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
        }),
    )
}

function hoistFunctionDeclaration(node: tsm.FunctionDeclaration): E.Either<ParseError, CompileTimeObject> {
    if (node.hasDeclareKeyword()) throw new CompileError("Expected function not to have declare keyword", node);
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => {
            const paramCount = node.getParameters().length;
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
    )
}

function hoistVariableDeclaration(scope: Scope) {
    return (node: tsm.VariableDeclaration): E.Either<readonly ParseError[], readonly ParsedVariable[]> => {
        const kind = node.getVariableStatement()?.getDeclarationKind();
        return pipe(
            E.Do,
            E.bind("bindings", () => parseVariableBindings(node)),
            E.bind("initOps", () => {
                return pipe(
                    node,
                    parseVariableInitializer(scope),
                    // ignore initializer errors during hoisting
                    E.match(() => ROA.empty, identity),
                    E.of<readonly ParseError[], readonly Operation[]>
                );
            }),
            E.map(({ bindings, initOps }) => parseBoundVariables(kind)(bindings, initOps)),
        );
    }
}

function hoistParsedVariables(staticVarCount: number) {
    return (parsedVars: readonly ParsedVariable[]) => {
        const constCTOs = pipe(
            parsedVars,
            ROA.filterMap(O.fromPredicate(isParsedConstant)),
            ROA.map(({ node, symbol, constant }) => {
                return <CompileTimeObject>{ node, symbol, loadOps: ROA.of(constant) };
            })
        );
        const vars = pipe(
            parsedVars,
            ROA.filterMap(O.fromPredicate(isVariableBinding)),
            ROA.mapWithIndex((index, { node, symbol }) => {
                const slotIndex = index + staticVarCount;
                const loadOps = ROA.of<Operation>({ kind: "loadstatic", index: slotIndex });
                const storeOps = ROA.of<Operation>({ kind: "storestatic", index: slotIndex });
                const cto = <CompileTimeObject>{ node, symbol, loadOps, storeOps };
                const debugVar = <ContractVariable>{ name: symbol.getName(), type: node.getType(), index: slotIndex };
                return { cto, debugVar };
            })
        );
        return {
            ctos: pipe(vars, ROA.map(({ cto }) => cto), ROA.concat(constCTOs)),
            debugVars: pipe(vars, ROA.map(({ debugVar }) => debugVar)),
        };
    }
}

function hoistConstEnumDeclaration(node: tsm.EnumDeclaration): E.Either<readonly ParseError[], CompileTimeObject> {
    if (!node.isConstEnum()) throw new CompileError("Expected enum to be const", node);
    return pipe(
        node.getMembers(),
        ROA.map(member => {
            return pipe(
                member,
                TS.parseSymbol,
                E.chain(symbol => {
                    return pipe(
                        member,
                        TS.getEnumValue,
                        E.map(value => typeof value === 'number' ? pushInt(value) : pushString(value)),
                        E.map(op => {
                            const resolver: PropertyResolver = () => E.of(<CompileTimeObject>{ node: member, symbol, loadOps: [op] });
                            return [symbol.getName(), resolver] as const;
                        }),
                        E.mapLeft(makeParseError(member))
                    )
                })
            )
        }),
        ROA.separate,
        SEP.map(makeReadOnlyMap),
        SEP.map(properties => <CompileTimeObject>{ node, loadOps: [], properties }),
        E_fromSeparated
    )
}

function parseVariableBindings(node: tsm.VariableDeclaration) {
    return pipe(
        node.getNameNode(),
        readNestedVariableBinding,
        E.map(flattenNestedVaribleBinding),
    );
}

function parseVariableInitializer(scope: Scope) {
    return (node: tsm.VariableDeclaration) => {
        return pipe(
            node.getInitializer(),
            O.fromNullable,
            O.map(parseExpression(scope)),
            O.match(() => E.of(ROA.empty), identity),
            E.mapLeft(ROA.of)
        );
    }
}

function parseBoundVariables(kind: tsm.VariableDeclarationKind | undefined) {
    return (bindings: readonly VariableBinding[], initOps: readonly Operation[]): readonly ParsedVariable[] => {
        return pipe(
            // only consider a binding to be a parsed constant if it's the only binding (i.e. no array/object binding)
            bindings,
            ROA.matchLeft(
                () => O.none,
                (head, tail) => ROA.isEmpty(tail) ? O.some(head) : O.none
            ),
            // also only consider a binding to be a parsed constant if it's a const declaration
            O.chain(O.fromPredicate(() => kind === tsm.VariableDeclarationKind.Const)),
            O.bindTo("binding"),
            // only consider a binding to be a parsed constant if it is a single push operation (not including no-ops)
            O.bind("pushOp", () => pipe(
                initOps,
                ROA.filter(op => op.kind !== "noop"),
                single,
                O.chain(O.fromPredicate(isPushOp)),
            )),
            O.match(
                // if the binding is not a single parsed constant, then cast the array of bindings to ParsedVariable array
                () => bindings as readonly ParsedVariable[],
                // if the binding is a single parsed constant, then return a singleton array of the parsed constant
                ({ binding, pushOp }) => {
                    const $const = <ParsedConstant>{ node: binding.node, symbol: binding.symbol, constant: pushOp };
                    return ROA.of($const);
                }
            )
        )
    }
}

