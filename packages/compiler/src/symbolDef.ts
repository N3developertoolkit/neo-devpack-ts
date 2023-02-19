import { Operation, parseOperation } from "./types/Operation";
import { createDiagnostic, isVoidLike } from "./utils";

import { sc, u } from '@cityofzion/neon-core';
import { ts, Node, VariableStatement, VariableDeclarationKind, SourceFile, Project, Symbol, VariableDeclaration, Expression, SyntaxKind, BigIntLiteral, NumericLiteral, StringLiteral, FunctionDeclaration, ImportDeclaration, ImportSpecifier, JSDocTag, InterfaceDeclaration, DiagnosticCategory, ParameterDeclaration } from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RONEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import * as SG from "fp-ts/Semigroup";
import * as S from 'fp-ts/State';
import { ParserState } from "./compiler";

type Diagnostic = ts.Diagnostic;

export interface SymbolDef {
    readonly symbol: Symbol;
}

export interface ObjectSymbolDef extends SymbolDef {
    //     // getProp(name: string): Resolver | undefined;
}

export interface CallableSymbolDef extends ObjectSymbolDef {
    //     // parseCall(node: tsm.CallExpression, scope: ReadonlyScope): {
    //     //     args: ParseExpressionResult, call: ParseExpressionResult };
}

// export function isObjectDef(def: SymbolDef): def is ObjectSymbolDef {
//     return 'getProp' in def && typeof def.getProp === 'function';
// }

// export function isFunctionDef(def: SymbolDef): def is FunctionDeclSymbolDef {
//     return isObjectDef(def) && 'parseCall' in def && typeof def.parseCall === 'function';
// }

export class InterfaceSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly node: InterfaceDeclaration,
    ) { }
}

export class FunctionSymbolDef implements CallableSymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly node: FunctionDeclaration,
        readonly $import: boolean,
    ) { }

    static create = ($import: boolean) =>
        (node: FunctionDeclaration, symbol: Symbol) =>
            new FunctionSymbolDef(symbol, node, $import);
}

type ConstantValue = bigint | boolean | Uint8Array | null;

export class ConstantSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly value: ConstantValue
    ) { }

    // loadOperations(): ParseExpressionResult {
    //     if (this.value === null) {
    //         return parseOK([{ kind: 'pushnull' }]);
    //     }
    //     if (this.value instanceof Uint8Array) {
    //         return parseOK([{ kind: 'pushdata', value: this.value } as PushDataOperation]);
    //     }
    //     switch (typeof this.value) {
    //         case 'boolean': {
    //             return parseOK([{ kind: 'pushbool', value: this.value } as PushBoolOperation]);
    //         }
    //         case 'bigint': {
    //             return parseOK([{ kind: 'pushint', value: this.value } as PushIntOperation]);
    //         }
    //         default:
    //             return parseError(`ConstantSymbolDef load ${this.value}`);
    //     }
    // }
}

export class VariableSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly kind: 'arg' | 'local' | 'static',
        readonly index: number
    ) { }

    // loadOperations(): ParseExpressionResult {
    //     const kind = this.kind === 'arg'
    //         ? "loadarg"
    //         : this.kind === 'local'
    //             ? 'loadlocal'
    //             : 'loadstatic';
    //     return parseOK([{ kind, index: this.index } as LoadStoreOperation]);
    // }
}

export class EventSymbolDef implements CallableSymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly name: string,
        readonly parameters: ReadonlyArray<ParameterDeclaration>,
    ) { }

    // parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
    //     // NCCS creates an empty array and then APPENDs each notification arg in turn
    //     // However, APPEND is 4x more expensive than PACK and is called once per arg
    //     // instead of once per Notify call as PACK is. 

    //     const argNodes = node.getArguments() as tsm.Expression[];
    //     const args = pipe(
    //         argNodes, 
    //         parseArguments(scope),
    //         E.map(flow(
    //             ROA.concat([
    //                 { kind: "pushint", value: BigInt(argNodes.length) },
    //                 { kind: 'pack' },
    //                 { kind: 'pushdata', value: Buffer.from(this.name, 'utf8') },
    //             ] as Operation[])
    //         )))
    //     const call = parseOK([{ kind: 'syscall', name: "System.Runtime.Notify" } as SysCallOperation]);
    //     return { call, args }
    // }

    // getProp(_name: string) { return undefined; }
}

export class SysCallSymbolDef implements CallableSymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly name: string,
    ) { }

    // parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
    //     const args = parseCallArguments(scope)(node);
    //     const call = parseOK([{ kind: 'syscall', name: this.name } as SysCallOperation]);
    //     return { call, args }
    // }

    // getProp(_name: string) { return undefined; }
}

export class MethodTokenSymbolDef implements CallableSymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly token: sc.MethodToken
    ) { }

    // parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
    //     const args = parseCallArguments(scope)(node);
    //     const call = parseOK([{ kind: 'calltoken', token: this.token } as CallTokenOperation]);
    //     return { call, args }
    // }

    // getProp(_name: string) { return undefined; }
}

export class OperationsSymbolDef implements CallableSymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly operations: ReadonlyArray<Operation>
    ) { }

    // parseCall(node: tsm.CallExpression, scope: ReadonlyScope) {
    //     const args = parseCallArguments(scope)(node);
    //     const call = parseOK(this.operations);
    //     return { call, args }
    // }

    // getProp(_name: string) { return undefined; }
}


interface ParseError { message: string, node?: Node }
type DiagnosticResult<T> = E.Either<ParseError, T>;

const makeParseError =
    (node?: Node) =>
        (e: string | unknown): ParseError => {
            const message = typeof e === 'string'
                ? e : e instanceof Error
                    ? e.message : String(e);
            return { message, node };
        }

const getResultSemigroup =
    <T>(sg: SG.Semigroup<T>): SG.Semigroup<DiagnosticResult<T>> => ({
        concat: (x, y) =>
            pipe(
                x,
                E.bindTo('x'),
                E.bind('y', () => y),
                E.map(({ x, y }) => sg.concat(x, y))
            )
    });

const getResultMonoid =
    <T>(monoid: M.Monoid<T>): M.Monoid<DiagnosticResult<T>> => ({
        concat: getResultSemigroup(monoid).concat,
        empty: E.right(monoid.empty)
    });

const getSymbol =
    (symbol?: Symbol) =>
        (node: Node): O.Option<Symbol> =>
            pipe(
                symbol,
                O.fromNullable,
                O.match(
                    () => pipe(
                        node.getSymbol(),
                        O.fromNullable
                    ),
                    (s) => O.some(s)
                )
            );

const parseSymbol =
    (symbol?: Symbol) =>
        (node: Node): DiagnosticResult<Symbol> =>
            pipe(
                node,
                getSymbol(symbol),
                O.match(
                    () => E.left(makeParseError(node)('invalid symbol')),
                    (s) => E.right(s)
                )
            );

const parseConstantValue =
    (node: Expression): DiagnosticResult<ConstantValue> => {
        switch (node.getKind()) {
            case SyntaxKind.NullKeyword:
                return E.right(null);
            case SyntaxKind.FalseKeyword:
                return E.right(false);
            case SyntaxKind.TrueKeyword:
                return E.right(true);
            case SyntaxKind.BigIntLiteral:
                return E.right((node as BigIntLiteral).getLiteralValue() as bigint);
            case SyntaxKind.NumericLiteral: {
                const literal = (node as NumericLiteral).getLiteralValue();
                return Number.isInteger(literal)
                    ? E.right(BigInt(literal))
                    : E.left(makeParseError(node)(`invalid non-integer numeric literal ${literal}`));
            }
            case SyntaxKind.StringLiteral:
                return E.right(Buffer.from((node as StringLiteral).getLiteralValue(), 'utf8'));
            // case tsm.SyntaxKind.ArrayLiteralExpression: 
            // case tsm.SyntaxKind.ObjectLiteralExpression:
            default:
                return E.left(makeParseError(node)(`Unsupported const type ${node.getKindName()}`));
        }
    }

const parseConstVariableDeclaration =
    (symbol?: Symbol) =>
        (node: VariableDeclaration): DiagnosticResult<SymbolDef> =>
            pipe(
                node.getInitializer(),
                O.fromNullable,
                E.fromOption(() =>
                    makeParseError(node)("missing initializer")),
                E.map(parseConstantValue),
                E.flatten,
                E.bindTo("value"),
                E.bind("symbol", () =>
                    pipe(
                        node,
                        parseSymbol(symbol)
                    )),
                E.map(({ symbol, value }) =>
                    new ConstantSymbolDef(symbol, value))
            );

const parseVariableDeclaration =
    (symbol?: Symbol) =>
        (node: VariableDeclaration): DiagnosticResult<SymbolDef> =>
            pipe(
                node.getVariableStatement(),
                E.fromNullable(makeParseError(node)("failed to get DeclarationKind")),
                E.map(stmt => stmt.getDeclarationKind()),
                E.map(kind => kind === VariableDeclarationKind.Const
                    ? parseConstVariableDeclaration(symbol)(node)
                    : E.left(makeParseError(node)(`${kind} VariableDeclaration not implemented`))),
                E.flatten
            );

const parseVariableStatement =
    (node: VariableStatement): DiagnosticResult<ReadonlyArray<SymbolDef>> =>
        pipe(
            node.getDeclarations(),
            ROA.map(flow(
                parseVariableDeclaration(),
                E.map(ROA.of)
            )),
            M.concatAll(
                getResultMonoid(
                    ROA.getMonoid<SymbolDef>()))
        );

const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\} ([_a-zA-Z0-9]+)/
const parseMethodToken =
    (node: FunctionDeclaration) =>
        (tag: JSDocTag): DiagnosticResult<sc.MethodToken> => {
            const comment = tag.getCommentText() ?? "";
            const matches = comment.match(regexMethodToken) ?? [];
            return matches.length === 3
                ? E.right(
                    new sc.MethodToken({
                        hash: u.HexString.fromHex(matches[1], true).toString(),
                        method: matches[2],
                        parametersCount: node.getParameters().length,
                        hasReturnValue: !isVoidLike(node.getReturnType()),
                        callFlags: sc.CallFlags.All
                    }))
                : E.left(
                    makeParseError(node)(`invalid method token tag comment "${comment}"`)
                );
        }

const regexOperation = /(\S+)\s?(\S+)?/
const $parseOperation =
    (node: Node) =>
        (comment: string): DiagnosticResult<Operation> => {
            const matches = comment.match(regexOperation) ?? [];
            const error = makeParseError(node)(`invalid operation tag comment "${comment}"`);
            return matches.length === 3
                ? pipe(
                    parseOperation(matches[1], matches[2]),
                    E.fromNullable(error)
                )
                : E.left(error);
        }

interface DeclareFunctionDeclarationOptions {
    readonly symbol: Symbol,
    readonly tags: RONEA.ReadonlyNonEmptyArray<JSDocTag>
}

const parseDeclareFunctionDeclaration =
    (node: FunctionDeclaration) =>
        ({ symbol, tags }: DeclareFunctionDeclarationOptions): DiagnosticResult<SymbolDef> => {
            const makeError = makeParseError(node)
            const head = RONEA.head(tags);
            switch (head.getTagName()) {
                case 'event':
                    return isVoidLike(node.getReturnType())
                        ? E.right(new EventSymbolDef(symbol, head.getCommentText() ?? symbol.getName(), node.getParameters()))
                        : E.left(makeError('event functions cannot have return values'));
                case 'methodToken':
                    return pipe(head,
                        parseMethodToken(node),
                        E.map(token => new MethodTokenSymbolDef(symbol, token)));
                case 'operation':
                    return pipe(tags,
                        ROA.filter(t => t.getTagName() === 'operation'),
                        ROA.map(flow(
                            t => t.getCommentText(),
                            E.fromNullable(makeError("missing operation JSDoc tag comment")),
                            E.map($parseOperation(node)),
                            E.flatten,
                            E.map(ROA.of),
                        )),
                        M.concatAll(getResultMonoid(ROA.getMonoid<Operation>())),
                        E.map(ops => new OperationsSymbolDef(symbol, ops))
                    )
                case 'syscall':
                    return E.right(new SysCallSymbolDef(symbol, head.getCommentText() ?? ""));
                default:
                    return E.left(makeError(`invalid function declaration tag ${head.getTagName()}`));
            }
        }

const parseInterfaceDeclaration =
    (symbol?: Symbol) =>
        (node: InterfaceDeclaration): DiagnosticResult<SymbolDef> =>
            pipe(
                node,
                parseSymbol(symbol),
                E.map(s => new InterfaceSymbolDef(s, node))
            );


const parseFunctionDeclaration = (symbol?: Symbol) =>
    (create: (node: FunctionDeclaration, symbol: Symbol) => SymbolDef) =>
        (node: FunctionDeclaration): DiagnosticResult<SymbolDef> =>
            node.hasDeclareKeyword()
                ? pipe(
                    node.getJsDocs(),
                    ROA.head,
                    O.map(d => pipe(d.getTags(), RONEA.fromArray)),
                    O.flatten,
                    E.fromOption(() =>
                        makeParseError(node)('declared functions must have a JSDoc block tag')),
                    E.bindTo('tags'),
                    E.bind('symbol', () => pipe(node, parseSymbol(symbol))),
                    E.chain(parseDeclareFunctionDeclaration(node))
                )
                : pipe(node,
                    parseSymbol(symbol),
                    E.map(symbol => create(node, symbol))
                );

const parseImportSpecifier =
    ($module: SourceFile) =>
        (node: ImportSpecifier): DiagnosticResult<SymbolDef> => {
            const $makeError = makeParseError(node);
            const exportMap = $module.getExportedDeclarations();

            return pipe(
                node.getSymbol(),
                E.fromNullable($makeError("missing symbol")),
                E.bindTo("symbol"),
                E.bind('name', ({ symbol }) => pipe(
                    symbol.getAliasedSymbol(),
                    O.fromNullable,
                    O.getOrElse(() => symbol),
                    ($symbol) => $symbol.getName(),
                    E.right) as DiagnosticResult<string>),
                E.bind('decl', ({ name }) => pipe(exportMap.get(name),
                    E.fromNullable($makeError(`missing export ${name}`)),
                    E.map(decls => decls.length === 1
                        ? E.right(decls[0])
                        : E.left($makeError(`multiple exported declarations ${name} not implemented`))),
                    E.flatten)),
                E.chain(({ symbol, decl: node }) => {
                    if (Node.isFunctionDeclaration(node))
                        return pipe(
                            node,
                            parseFunctionDeclaration(symbol)(FunctionSymbolDef.create(true))
                        );
                    if (Node.isVariableDeclaration(node))
                        return pipe(
                            node,
                            parseVariableDeclaration(symbol)
                        );
                    if (Node.isInterfaceDeclaration(node))
                        return pipe(
                            node, parseInterfaceDeclaration(symbol)
                        );
                    return E.left(makeParseError(node)(`parseImportSpecifier ${node.getKindName()}`));
                })
            );
        }

const parseImportDeclaration =
    (node: ImportDeclaration): DiagnosticResult<ReadonlyArray<SymbolDef>> =>
        pipe(
            node.getModuleSpecifierSourceFile(),
            E.fromNullable(makeParseError(node)(`getModuleSpecifierSourceFile failed`)),
            E.bindTo("$module"),
            E.bind("$imports", () => E.right(node.getNamedImports())),
            E.map(({ $module, $imports }) =>
                pipe(
                    $imports,
                    ROA.map(flow(parseImportSpecifier($module), E.map(ROA.of))),
                    M.concatAll(getResultMonoid(ROA.getMonoid<SymbolDef>()))
                )
            ),
            E.flatten
        );

export const parseSourceFile =
    (src: SourceFile): ParserState<ReadonlyArray<SymbolDef>> =>
        (diagnostics: ReadonlyArray<Diagnostic>) => {
            const diagnosticsSG = ROA.getSemigroup<Diagnostic>();

            if (src.isDeclarationFile()) {
                const diag = createDiagnostic(
                    `${src.getFilePath()} is a declaration file`,
                    {
                        category: DiagnosticCategory.Warning,
                        node: src
                    });

                diagnostics = diagnosticsSG.concat(diagnostics, [diag]);
                return [[], diagnostics];
            }

            const { left: errors, right: defs } = pipe(
                src.forEachChildAsArray(),
                ROA.map(node => {
                    if (Node.isFunctionDeclaration(node))
                        return pipe(
                            node,
                            parseFunctionDeclaration()(FunctionSymbolDef.create(false)),
                            E.map(ROA.of)
                        );
                    if (Node.isImportDeclaration(node))
                        return parseImportDeclaration(node);
                    if (Node.isVariableStatement(node))
                        return parseVariableStatement(node);
                    if (Node.isInterfaceDeclaration(node))
                        return pipe(
                            node,
                            parseInterfaceDeclaration(),
                            E.map(ROA.of)
                        );
                    if (node.getKind() == SyntaxKind.EndOfFileToken)
                        return E.right([]);
                    return E.left(makeParseError(node)(`parseSourceFileSymbols ${node.getKindName()}`));
                }),
                ROA.partitionMap(q => q)
            );

            diagnostics = diagnosticsSG.concat(
                diagnostics,
                errors.map(e => createDiagnostic(e.message, { node: e.node }))
            );

            return [
                pipe(defs, M.concatAll(ROA.getMonoid<SymbolDef>())),
                diagnostics
            ];
        }

export const parseProjectSymbols =
    (prj: Project): ParserState<ReadonlyArray<ReadonlyArray<SymbolDef>>> =>
        (diagnostics: ReadonlyArray<Diagnostic>) => {

            const sourceParsers = pipe(
                prj.getSourceFiles(),
                ROA.filter(s => !s.isDeclarationFile()),
                ROA.map(parseSourceFile)
            )

            return S.sequenceArray(sourceParsers)(diagnostics);
        }
