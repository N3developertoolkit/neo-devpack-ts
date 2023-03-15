import { Node, Symbol, FunctionDeclaration, JSDocTag, VariableStatement, Expression, SyntaxKind, VariableDeclarationKind, SourceFile, VariableDeclaration, CallExpression, Project } from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import * as TS from '../utility/TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as MONOID from 'fp-ts/Monoid'

import { single } from "../utils";
import { flow, identity, pipe } from "fp-ts/function";
import { CompiledProject, CompilerState, ContractEvent, ContractMethod } from "../types/CompileOptions";
import { $SymbolDef, makeParseDiagnostic, makeParseError, } from "../symbolDef";
import { parseContractMethod } from "./functionDeclarationProcessor";
import { parseArguments, parseExpression } from './expressionProcessor';
import { Operation } from "../types/Operation";
import { createScope, updateScope } from "../scope";
import { CallableSymbolDef, ParseArgumentsFunc, ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { parseSymbol } from "./parseSymbol";

interface ParseSourceContext {
    readonly scope: Scope
    readonly staticVars: readonly StaticVarSymbolDef[];
    readonly errors: ReadonlyArray<ParseError>
}

export interface ParseSourceResults {
    readonly methods: readonly ContractMethod[],
    readonly staticVars: readonly StaticVarSymbolDef[],
}

class StaticVarSymbolDef extends $SymbolDef {
    get loadOps(): readonly Operation[] {
        return [{ kind: "loadstatic", index: this.index }];
    }
    get storeOps(): readonly Operation[] {
        return [{ kind: "storestatic", index: this.index }];
    }

    constructor(
        readonly decl: VariableDeclaration,
        symbol: Symbol,
        readonly index: number,
        readonly initOps?: readonly Operation[]
    ) {
        super(decl, symbol);
    }
}

class ConstantSymbolDef extends $SymbolDef {
    readonly loadOps: readonly Operation[];

    constructor(
        readonly decl: VariableDeclaration,
        symbol: Symbol,
        op: Operation
    ) {
        super(decl, symbol);
        this.loadOps = [op];
    }
}

class EventFunctionSymbolDef extends $SymbolDef implements CallableSymbolDef {

    readonly loadOps: readonly Operation[];
    readonly props = [];

    constructor(
        readonly decl: FunctionDeclaration,
        symbol: Symbol,
        readonly eventName: string
    ) {
        super(decl, symbol);
        this.loadOps = ROA.of({ kind: 'syscall', name: "System.Runtime.Notify" })
    }

    parseArguments = (scope: Scope) => (node: CallExpression): E.Either<ParseError, ReadonlyArray<Operation>> => {
        return pipe(
            node,
            parseArguments(scope),
            E.map(ROA.concat([
                { kind: "pushint", value: BigInt(node.getArguments().length) },
                { kind: 'pack' },
                { kind: 'pushdata', value: Buffer.from(this.name, 'utf8') }
            ] as readonly Operation[]))
        );
    }

    static create(decl: FunctionDeclaration, tag: JSDocTag): E.Either<ParseError, EventFunctionSymbolDef> {
        return pipe(
            decl,
            parseSymbol,
            E.map(symbol => {
                const eventName = tag.getCommentText() ?? symbol.getName();
                return new EventFunctionSymbolDef(decl, symbol, eventName);
            })
        );
    }
}

class LocalFunctionSymbolDef extends $SymbolDef implements CallableSymbolDef {

    readonly loadOps: readonly Operation[];
    readonly props = [];
    readonly parseArguments: ParseArgumentsFunc;

    constructor(readonly decl: FunctionDeclaration, symbol: Symbol) {
        super(decl, symbol);
        this.loadOps = [{ kind: 'call', method: this.symbol }]
        this.parseArguments = parseArguments;
    }

    static create(decl: FunctionDeclaration): E.Either<ParseError, LocalFunctionSymbolDef> {
        return pipe(
            decl,
            parseSymbol,
            E.map(symbol => new LocalFunctionSymbolDef(decl, symbol)),
        )
    }
}

const parseSrcFunctionDeclaration = (node: FunctionDeclaration): E.Either<ParseError, SymbolDef> => {
    if (node.hasDeclareKeyword()) {
        return pipe(
            node,
            TS.getTag("event"),
            E.fromOption(() => makeParseError(node)('only @event declare functions supported')),
            E.chain(tag => EventFunctionSymbolDef.create(node, tag)),
        )
    } else {
        return LocalFunctionSymbolDef.create(node);
    }
}

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}

const parseConstVariableDeclaration =
    (node: VariableDeclaration) =>
        (context: ParseSourceContext): ParseSourceContext => {

            const init = node.getInitializer();
            if (!init) {
                return {
                    ...context,
                    errors: ROA.append(makeParseError(node)('missing initializer'))(context.errors)
                }
            }

            return pipe(
                node.getInitializer(),
                E.fromNullable(makeParseError(node)('missing initializer')),
                E.chain(parseExpression(context.scope)),
                E.bindTo('init'),
                E.bind('symbol', () => parseSymbol(node)),
                E.map(({ init, symbol }) => {

                    if (init.length === 1 && isPushOp(init[0])) {
                        const def = new ConstantSymbolDef(node, symbol, init[0])
                        const scope = updateScope(context.scope)([def]);
                        return { ...context, scope } as ParseSourceContext;
                    } else {
                        const def = new StaticVarSymbolDef(node, symbol, context.staticVars.length, init);
                        const scope = updateScope(context.scope)([def]);
                        const staticVars = ROA.append(def)(context.staticVars);
                        return { ...context, scope, staticVars };
                    }
                }),
                E.match(
                    error => ({ ...context, errors: ROA.append(error)(context.errors) }),
                    identity
                )
            )
        }

const parseLetVariableDeclaration =
    (node: VariableDeclaration) =>
        (context: ParseSourceContext): ParseSourceContext => {

            const $init = node.getInitializer();
            const init: E.Either<ParseError, O.Option<readonly Operation[]>> = $init
                ? pipe($init, parseExpression(context.scope), E.map(O.of))
                : E.right(O.none);

            return pipe(
                node.getInitializer(),
                O.fromNullable,
                O.match(
                    () => E.right(O.none),
                    flow(parseExpression(context.scope), E.map(O.of))
                ),
                E.bindTo('init'),
                E.bind('symbol', () => parseSymbol(node)),
                E.map(({ init, symbol }) => {
                    const def = new StaticVarSymbolDef(node, symbol, context.staticVars.length, O.toUndefined(init))
                    const scope = updateScope(context.scope)([def]);
                    const staticVars = ROA.append(def)(context.staticVars);
                    return { ...context, scope, staticVars } as ParseSourceContext;

                }),
                E.match(
                    error => ({ ...context, errors: ROA.append(error)(context.errors) }),
                    identity
                )
            )
        }


const parseVariableStatement =
    (node: VariableStatement) =>
        (context: ParseSourceContext): ParseSourceContext => {

            const pareDecl = node.getDeclarationKind() === VariableDeclarationKind.Const
                ? parseConstVariableDeclaration
                : parseLetVariableDeclaration;

            for (const decl of node.getDeclarations()) {
                context = pareDecl(decl)(context);
            }
            return context;
        }

const parseSourceNode =
    (node: Node): S.State<ParseSourceContext, CompiledProject> =>
        (context) => {

            if (Node.isFunctionDeclaration(node)) {
                if (node.hasDeclareKeyword()) {
                    return pipe(
                        node,
                        TS.getTag("event"),
                        E.fromOption(() => makeParseError(node)('only @event declare functions supported')),
                        E.chain(() => pipe(node, parseSymbol)),
                        E.map(symbol => ({ symbol, node } as ContractEvent)),
                        E.mapLeft(ROA.of),
                        E.mapLeft(errors => ROA.concat(errors)(context.errors)),
                        E.map(ROA.of),
                        E.match(
                            errors => [compiledProjectMonoid.empty, { ...context, errors }],
                            events => [{ methods: [], events }, context]
                        )
                    )
                }
                else {
                    return pipe(
                        node,
                        parseContractMethod(context.scope),
                        E.mapLeft(errors => ROA.concat(errors)(context.errors)),
                        E.map(ROA.of),
                        E.match(
                            errors => [compiledProjectMonoid.empty, { ...context, errors }],
                            methods => [{ methods, events: [] }, context],
                        )
                    )
                }
            }
            if (Node.isVariableStatement(node)) {
                return [compiledProjectMonoid.empty, parseVariableStatement(node)(context)]
            }
            if (node.getKind() === SyntaxKind.EndOfFileToken) return [compiledProjectMonoid.empty, context];

            const error = makeParseError(node)(`parseSourceNode ${node.getKindName()} not impl`);
            return [compiledProjectMonoid.empty, { ...context, errors: ROA.append(error)(context.errors) }]
        }

const parseSourceFile =
    (src: SourceFile): S.State<ParseSourceContext, CompiledProject> =>
        context => {
            const children = pipe(src, TS.getChildren);
            const { left: errors, right: functionDefs } = pipe(
                children,
                ROA.filterMap(O.fromPredicate(Node.isFunctionDeclaration)),
                ROA.map(parseSrcFunctionDeclaration),
                ROA.separate
            );

            if (errors.length > 0) {
                return [compiledProjectMonoid.empty, {
                    ...context,
                    errors: ROA.concat(errors)(context.errors)
                }]
            }

            context = { ...context, scope: createScope(context.scope)(functionDefs) };
            let compiledProject = compiledProjectMonoid.empty;
            for (const node of children) {
                let results;
                [results, context] = parseSourceNode(node)(context);
                compiledProject = compiledProjectMonoid.concat(compiledProject, results);
            }

            return [compiledProject, context]
        }


const compiledProjectMonoid: MONOID.Monoid<CompiledProject> = {
    empty: { methods: [], events: [] },
    concat(x, y) {
        return {
            methods: ROA.concat(y.methods)(x.methods),
            events: ROA.concat(y.events)(x.events)
        }
    },
}

export const parseProject =
    (project: Project) =>
        (scope: Scope): CompilerState<CompiledProject> =>
            (diagnostics) => {

                let context: ParseSourceContext = {
                    scope,
                    errors: ROA.empty,
                    staticVars: ROA.empty
                }

                let compiledProject = compiledProjectMonoid.empty;
                for (const src of project.getSourceFiles()) {
                    if (src.isDeclarationFile()) continue;
                    let results;
                    [results, context] = parseSourceFile(src)(context);
                    compiledProject = compiledProjectMonoid.concat(compiledProject, results);
                }

                diagnostics = pipe(
                    context.errors,
                    ROA.map(makeParseDiagnostic),
                    parseDiags => ROA.concat(parseDiags)(diagnostics)
                )

                if (context.staticVars.length > 0) {
                    const operations = pipe(context.staticVars,
                        ROA.reduce(
                            ROA.of({ kind: 'initstatic', count: context.staticVars.length } as Operation),
                            (ops, $static) => {
                                return $static.initOps
                                    ? pipe(ops, ROA.concat($static.initOps), ROA.concat($static.storeOps))
                                    : ops
                            },

                        ),
                        ROA.append({ kind: 'return' } as Operation),
                    );

                    const src = project.getSourceFiles()[0];
                    const name = "_initialize"
                    const init = src.addFunction({
                        name,
                        isExported: true
                    });

                    const initMethod = {
                        name,
                        node: init,
                        symbol: init.getSymbolOrThrow(),
                        operations,
                        variables: ROA.empty
                    } as ContractMethod;

                    compiledProject = compiledProjectMonoid.concat(compiledProject, { methods: [initMethod], events: [] });
                }

                return [compiledProject, diagnostics];
            }

