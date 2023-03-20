import { Node, Symbol, FunctionDeclaration, JSDocTag, VariableStatement, Expression, SyntaxKind, VariableDeclarationKind, SourceFile, VariableDeclaration, CallExpression, Project, InterfaceDeclaration, PropertySignature } from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import * as TS from '../utility/TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as MONOID from 'fp-ts/Monoid'

import { flow, identity, pipe } from "fp-ts/function";
import { CompiledProject, CompilerState, ContractEvent, ContractMethod } from "../types/CompileOptions";
import { $SymbolDef, makeParseDiagnostic, makeParseError, } from "../symbolDef";
import { parseContractMethod } from "./functionDeclarationProcessor";
import { parseArguments, parseExpression } from './expressionProcessor';
import { Operation } from "../types/Operation";
import { createScope, updateScope } from "../scope";
import { CallableSymbolDef, ObjectSymbolDef, ParseArgumentsFunc, ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { parseSymbol } from "./parseSymbol";
import { single } from "../utils";
import { ConstantSymbolDef, EventFunctionSymbolDef, LocalFunctionSymbolDef, StaticVarSymbolDef, StructMemberSymbolDef, StructSymbolDef } from "./sourceSymbolDefs";

interface ParseSourceContext {
    readonly scope: Scope
    readonly staticVars: readonly StaticVarSymbolDef[];
    readonly errors: ReadonlyArray<ParseError>
}

export interface ParseSourceResults {
    readonly methods: readonly ContractMethod[],
    readonly staticVars: readonly StaticVarSymbolDef[],
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

const parseSrcInterfaceDeclaration = (node: InterfaceDeclaration): E.Either<ParseError, SymbolDef> => {

    return pipe(
        node,
        TS.getTag("struct"),
        E.fromOption(() => makeParseError(node)('only @struct interfaces are supported')),
        E.chain(() => {
            return pipe(
                node,
                TS.getType,
                TS.getTypeProperties,
                ROA.mapWithIndex((index, symbol) => {
                    return pipe(
                        symbol.getDeclarations(),
                        single,
                        O.chain(O.fromPredicate(Node.isPropertySignature)),
                        O.map(sig => new StructMemberSymbolDef(sig, index)),
                        E.fromOption(() => `${symbol.getName()} invalid struct property`));
                }),
                ROA.separate,
                ({left: errors, right: members }) => {
                    return errors.length > 0
                        ? E.left<ParseError, readonly SymbolDef[]>(makeParseError(node)(errors.join(", ")))
                        : E.of<ParseError, readonly SymbolDef[]>(members);
                },
                E.map(props => {
                    return new StructSymbolDef(node, props);
                })
            );
        })
    )
}

const parseSrcNode = (node: Node): E.Either<ParseError, O.Option<SymbolDef>> => {
    if (Node.isFunctionDeclaration(node)) {
        return pipe(node, parseSrcFunctionDeclaration, E.map(O.of))
    }
    if (Node.isInterfaceDeclaration(node)) {
        return pipe(node, parseSrcInterfaceDeclaration, E.map(O.of))
    }
    return E.of(O.none);
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
                    const initOp = pipe(
                        init,
                        ROA.filter(op => op.kind != 'noop'),
                        single,
                        O.toUndefined
                    )
                    // if the init expression is a single push operation, register 
                    // a constant symbol, which enables the value to be inserted
                    // at compile time rather than loaded at runtime 
                    if (initOp && isPushOp(initOp)) {
                        const def = new ConstantSymbolDef(node, symbol, initOp)
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

            const parseDecl = node.getDeclarationKind() === VariableDeclarationKind.Const
                ? parseConstVariableDeclaration
                : parseLetVariableDeclaration;

            for (const decl of node.getDeclarations()) {
                context = parseDecl(decl)(context);
            }
            return context;
        }

const parseInterfaceDeclaration =
    (node: InterfaceDeclaration) =>
        (context: ParseSourceContext): ParseSourceContext => {


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
            // interface declarations are handled in the first pass of parseSourceFile
            if (Node.isInterfaceDeclaration(node)) return [compiledProjectMonoid.empty, context];
            if (node.getKind() === SyntaxKind.EndOfFileToken) return [compiledProjectMonoid.empty, context];

            const error = makeParseError(node)(`parseSourceNode ${node.getKindName()} not impl`);
            return [compiledProjectMonoid.empty, { ...context, errors: ROA.append(error)(context.errors) }]
        }


function asOptionEither<E, A>(item: E.Either<E, O.Option<A>>) {
    return pipe(item, E.match(
        error => O.some(E.left<E, A>(error)),
        flow(O.match(
            () => O.none,
            value => O.some(E.of<E, A>(value))
        ))
    ))
}

const parseSourceFile =
    (src: SourceFile): S.State<ParseSourceContext, CompiledProject> =>
        context => {
            const children = pipe(src, TS.getChildren);
            const { left: errors, right: defs } = pipe(
                children,
                ROA.map(parseSrcNode),
                // filter out src nodes that didn't return a symbol def
                ROA.filterMap(asOptionEither),
                ROA.separate
            );

            if (errors.length > 0) {
                return [compiledProjectMonoid.empty, {
                    ...context,
                    errors: ROA.concat(errors)(context.errors)
                }]
            }

            context = { ...context, scope: createScope(context.scope)(defs) };
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

