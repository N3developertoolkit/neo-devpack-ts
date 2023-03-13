import { Node, Symbol, FunctionDeclaration, JSDocTag, VariableStatement, Expression, SyntaxKind, BigIntLiteral, NumericLiteral, StringLiteral, VariableDeclarationKind, SourceFile, ts, VariableDeclaration, CallExpression, Project } from "ts-morph";
import { createScope, Scope, updateScope } from "../scope";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import * as TS from '../utility/TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'

import { createDiagnostic, single } from "../utils";
import { identity, pipe } from "fp-ts/function";
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
        (node: Expression): E.Either<ParseError, Operation> => {
            return pipe(
                node,
                parseExpression(scope),
                O.fromEither,
                O.chain(single),
                O.chain(O.fromPredicate(isPushOp)),
                E.fromOption(() => makeParseError(node)('invalid const'))
            );
        }

const parseConstVariableStatement =
    (scope: Scope) =>
        (node: VariableStatement): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> => {

            if (node.getDeclarationKind() !== VariableDeclarationKind.Const)
                return E.left(ROA.of(makeParseError(node)('non const variable statement passed to parseConstVariableStatement')))

            const { left: failures, right: sources } = pipe(
                node.getDeclarations(),
                ROA.map(decl => {
                    return pipe(
                        decl.getInitializer(),
                        E.fromNullable(makeParseError(decl)('missing initializer')),
                        E.chain(parseConstantValue(scope)),
                        E.bindTo('operation'),
                        E.bind('symbol', () => parseSymbol(decl)),
                        E.map(({ operation, symbol }) => new ConstantSymbolDef(decl, symbol, operation))
                    )
                }),
                ROA.partitionMap(identity),
            )

            return failures.length > 0 ? E.left(failures) : E.right(sources);
        }


const parseSourceNode =
    (node: Node): S.State<ParseSourceContext, O.Option<ContractMethod>> =>
        (context) => {

            function makeErrorCtx(message: string): [O.Option<ContractMethod>, ParseSourceContext] {
                const error = makeParseError(node)(message);
                const errors = ROA.append(error)(context.errors);
                return [O.none, { ...context, errors }];
            }

            if (node.getKind() == SyntaxKind.EndOfFileToken) {
                return [O.none, context];
            }

            if (Node.isFunctionDeclaration(node)) {
                return pipe(
                    node,
                    parseContractMethod(context.scope),
                    E.match(
                        errors => {
                            errors = ROA.concat(errors)(context.errors)
                            return [O.none, { ...context, errors }]
                        },
                        method => {
                            return [O.some(method), context];
                        }
                    )
                );
            }

            if (Node.isVariableStatement(node)) {
                if (node.getDeclarationKind() === VariableDeclarationKind.Const) {
                    return pipe(
                        node,
                        parseConstVariableStatement(context.scope),
                        E.match(
                            errors => {
                                errors = ROA.concat(errors)(context.errors)
                                return [O.none, { ...context, errors }]
                            },
                            defs => {
                                const scope = updateScope(context.scope)(defs);
                                return [O.none, { ...context, scope }]
                            }
                        )
                    );
                } else {
                    return makeErrorCtx(`static variables not impl`);
                }
            }

            return makeErrorCtx(`parseSourceNode ${node.getKindName()}`);
        }



// export const parseSourceFileOLD =
//     (src: SourceFile, parentScope: Scope): S.State<ReadonlyArray<ts.Diagnostic>, ParseSourceResults> =>
//         diagnostics => {
//             const emptyContents: ParseSourceResults = { methods: [], staticVars: [] }

//             if (src.isDeclarationFile()) {
//                 const diag = createDiagnostic(`${src.getFilePath()} is a declaration file`, {
//                     node: src,
//                     category: ts.DiagnosticCategory.Warning
//                 });
//                 return [emptyContents, ROA.append(diag)(diagnostics)]
//             }

//             const children = pipe(src, TS.getChildren);
//             const { left: errors, right: functionDefs } = pipe(
//                 children,
//                 ROA.filterMap(O.fromPredicate(Node.isFunctionDeclaration)),
//                 ROA.map(parseSrcFunctionDeclaration),
//                 ROA.map(E.mapLeft(makeParseDiagnostic)),
//                 ROA.separate
//             );

//             if (errors.length > 0) {
//                 return [emptyContents, ROA.concat(errors)(diagnostics)]
//             }

//             let context: ParseSourceContext = {
//                 errors: ROA.empty,
//                 staticVars: ROA.empty,
//                 scope: createScope(parentScope)(functionDefs),
//             }
//             let methods: ReadonlyArray<ContractMethod> = ROA.empty;

//             for (const node of children) {
//                 let $method;
//                 [$method, context] = parseSourceNode(node)(context);
//                 methods = pipe(
//                     $method,
//                     O.match(
//                         () => methods,
//                         m => ROA.append(m)(methods)
//                     )
//                 )
//             }

//             const diags = pipe(context.errors, ROA.map(makeParseDiagnostic));
//             return [
//                 {
//                     methods,
//                     staticVars: []
//                 },
//                 ROA.concat(diags)(diagnostics)
//             ];
//         }

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
        (project: Project): CompilerState<readonly ContractMethod[]> =>
            (diagnostics) => {

                let methods: ReadonlyArray<ContractMethod> = ROA.empty;
                let context: ParseSourceContext = {
                    scope,
                    errors: ROA.empty,
                    staticVars: ROA.empty
                }

                for (const src of project.getSourceFiles()) {
                    if (src.isDeclarationFile()) continue;
                    let $methods;
                    [$methods, context] = parseSourceFile(src)(context);
                    methods = ROA.concat($methods)(methods);
                }

                diagnostics = pipe(
                    context.errors,
                    ROA.map(makeParseDiagnostic),
                    ROA.concat(diagnostics)
                )

                // TODO: create _init method if needed

                return [methods, diagnostics];
            }

