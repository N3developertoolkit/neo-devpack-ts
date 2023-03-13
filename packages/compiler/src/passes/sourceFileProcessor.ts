import { Node, Symbol, FunctionDeclaration, JSDocTag, VariableStatement, Expression, SyntaxKind, VariableDeclarationKind, SourceFile, VariableDeclaration, CallExpression, Project } from "ts-morph";
import { createScope, Scope, updateScope } from "../scope";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import * as TS from '../utility/TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'

import { single } from "../utils";
import { flow, identity, pipe } from "fp-ts/function";
import { CompilerState, ContractMethod } from "../compiler";
import { $SymbolDef, CallableSymbolDef, makeParseDiagnostic, makeParseError, ParseArgumentsFunc, ParseError, SymbolDef } from "../symbolDef";
import { parseContractMethod } from "./functionDeclarationProcessor";
import { Operation } from "../types";
import { parseArguments, parseExpression } from './expressionProcessor';

export const parseSymbol = (node: Node): E.Either<ParseError, Symbol> => {
    return pipe(
        node,
        TS.getSymbol,
        E.fromOption(() => makeParseError(node)('invalid symbol'))
    );
}

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

const parseSrcLetVariableStatement = (node: VariableStatement): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> => {
    if (node.getDeclarationKind() === VariableDeclarationKind.Const)
        return E.left(ROA.of(makeParseError(node)('const variable statement passed to parseSrcLetVariableStatement')))

    return E.left(ROA.of(makeParseError(node)(`parseSrcVariableStatement not implemented`)));
}

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}


const parseConstantValue =
    (scope: Scope) =>
        (node: Expression): O.Option<Operation> => {
            return pipe(
                node,
                parseExpression(scope),
                O.fromEither,
                O.chain(single),
                O.chain(O.fromPredicate(isPushOp)),
            );
        }

// const parseConstVariableStatement =
//     (scope: Scope) =>
//         (node: VariableStatement): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> => {

//             if (node.getDeclarationKind() !== VariableDeclarationKind.Const)
//                 return E.left(ROA.of(makeParseError(node)('non const variable statement passed to parseConstVariableStatement')))

//             const { left: failures, right: sources } = pipe(
//                 node.getDeclarations(),
//                 ROA.map(decl => {
//                     return pipe(
//                         decl.getInitializer(),
//                         E.fromNullable(makeParseError(decl)('missing initializer')),
//                         E.chain(parseConstantValue(scope)),
//                         E.bindTo('operation'),
//                         E.bind('symbol', () => parseSymbol(decl)),
//                         E.map(({ operation, symbol }) => new ConstantSymbolDef(decl, symbol, operation))
//                     )
//                 }),
//                 ROA.partitionMap(identity),
//             )

//             return failures.length > 0 ? E.left(failures) : E.right(sources);
//         }

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
    (node: Node): S.State<ParseSourceContext, O.Option<ContractMethod>> =>
        (context) => {

            if (Node.isFunctionDeclaration(node)) {
                if (node.hasDeclareKeyword()) return [O.none, context];
                return pipe(
                    node,
                    parseContractMethod(context.scope),
                    E.mapLeft(errors => ROA.concat(errors)(context.errors)),
                    E.map(O.of),
                    E.match(
                        errors => [O.none, { ...context, errors }],
                        method => [method, context],
                    )
                )
            }
            if (Node.isVariableStatement(node)) {
                return [O.none, parseVariableStatement(node)(context)]
            }
            if (node.getKind() === SyntaxKind.EndOfFileToken) return [O.none, context];

            const error = makeParseError(node)(`parseSourceNode ${node.getKindName()} not impl`);
            return [O.none, { ...context, errors: ROA.append(error)(context.errors) }]
        }

const parseSourceFile =
    (src: SourceFile): S.State<ParseSourceContext, readonly ContractMethod[]> =>
        context => {
            const children = pipe(src, TS.getChildren);
            const { left: errors, right: functionDefs } = pipe(
                children,
                ROA.filterMap(O.fromPredicate(Node.isFunctionDeclaration)),
                ROA.map(parseSrcFunctionDeclaration),
                ROA.separate
            );

            if (errors.length > 0) {
                return [[], {
                    ...context,
                    errors: ROA.concat(errors)(context.errors)
                }]
            }

            context = { ...context, scope: createScope(context.scope)(functionDefs) };
            let methods: ReadonlyArray<ContractMethod> = ROA.empty;
            for (const node of children) {
                let $method;
                [$method, context] = parseSourceNode(node)(context);
                methods = pipe(
                    $method,
                    O.match(
                        () => methods,
                        m => ROA.append(m)(methods)
                    )
                )
            }

            return [methods, context]
        }

export const parseProject =
    (scope: Scope) =>
        (project: Project): CompilerState<ReadonlyArray<ContractMethod>> =>
            (diagnostics) => {

                let context: ParseSourceContext = {
                    scope,
                    errors: ROA.empty,
                    staticVars: ROA.empty
                }
                let methods: ReadonlyArray<ContractMethod> = ROA.empty;
                for (const src of project.getSourceFiles()) {
                    if (src.isDeclarationFile()) continue;
                    let $methods;
                    [$methods, context] = parseSourceFile(src)(context);
                    methods = ROA.concat($methods)(methods);
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
                    methods = pipe(methods, ROA.prepend({
                        name,
                        node: init,
                        symbol: init.getSymbolOrThrow(),
                        operations,
                        variables: ROA.empty
                    } as ContractMethod))
                }

                return [methods, diagnostics];
            }

