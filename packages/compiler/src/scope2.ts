import { Node, VariableStatement, VariableDeclarationKind, SourceFile, Project, Symbol, VariableDeclaration, Expression, SyntaxKind, BigIntLiteral, NumericLiteral, StringLiteral, FunctionDeclaration, ImportDeclaration, ImportSpecifier, JSDocTag, InterfaceDeclaration } from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RONEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import { ConstantSymbolDef, EventSymbolDef, MethodTokenSymbolDef, OperationsSymbolDef, SymbolDef, SysCallSymbolDef } from "./scope";
import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
import * as S from "fp-ts/Semigroup";
import * as F from 'fp-ts/Functor';
import { isVoidLike } from "./utils";
import { sc, u } from '@cityofzion/neon-core';
import { Operation, parseOperation } from "./types/Operation";

interface ParseError { message: string, node?: Node }
type DiagnosticResult<T> = E.Either<ParseError, T>;

const makeParseError = (node?: Node) =>
    (e: string | unknown): ParseError => {
        const message = e instanceof Error ? e.message : String(e);
        return { message, node };
    }

const getResultSemigroup = <T>(sg: S.Semigroup<T>): S.Semigroup<DiagnosticResult<T>> => ({
    concat: (x, y) => pipe(
        x,
        E.bindTo('x'),
        E.bind('y', () => y),
        E.map(({ x, y }) => sg.concat(x, y))
    )
});

const getResultMonoid = <T>(monoid: M.Monoid<T>): M.Monoid<DiagnosticResult<T>> => ({
    concat: getResultSemigroup(monoid).concat,
    empty: E.right(monoid.empty)
});

const getSymbol = (symbol?: Symbol) =>
    (node: Node) => pipe(
        symbol,
        O.fromNullable,
        O.match(
            () => pipe(node.getSymbol(), O.fromNullable),
            (s) => O.some(s)
        )
    );

const parseSymbol = (symbol?: Symbol) =>
    (node: Node) => pipe(
        node,
        getSymbol(symbol),
        O.match(
            () => E.left(makeParseError(node)('invalid symbol')),
            (s) => E.right(s)
        )
    );

type ConstValue = bigint | boolean | ReadonlyUint8Array | null;

function parseConstantValue(node: Expression): DiagnosticResult<ConstValue> {
    switch (node.getKind()) {
        case SyntaxKind.NullKeyword: return E.right(null);
        case SyntaxKind.FalseKeyword: return E.right(false);
        case SyntaxKind.TrueKeyword: return E.right(true);
        case SyntaxKind.BigIntLiteral:
            return E.right((node as BigIntLiteral).getLiteralValue() as bigint);
        case SyntaxKind.NumericLiteral: {
            const literal = (node as NumericLiteral).getLiteralValue();
            return Number.isInteger(literal)
                ? E.right(BigInt(literal))
                : E.left(makeParseError(node)(`invalid non-integer numeric literal ${literal}`));
        }
        case SyntaxKind.StringLiteral: {
            const literal = (node as StringLiteral).getLiteralValue();
            return E.right(Buffer.from(literal, 'utf8') as ReadonlyUint8Array);
        }
        // case tsm.SyntaxKind.ArrayLiteralExpression: 
        // case tsm.SyntaxKind.ObjectLiteralExpression:
        default:
            return E.left(makeParseError(node)(`Unsupported const type ${node.getKindName()}`));
    }
}

const parseConstVariableDeclaration = (symbol?: Symbol) =>
    (node: VariableDeclaration): DiagnosticResult<SymbolDef> => pipe(
        node.getInitializer(),
        O.fromNullable,
        E.fromOption(() => makeParseError(node)("missing initializer")),
        E.map(parseConstantValue),
        E.flatten,
        E.bindTo("value"),
        E.bind("symbol", () => pipe(node, parseSymbol(symbol))),
        E.map(({ symbol, value }) => new ConstantSymbolDef(symbol, value))
    );

const parseVariableDeclaration = (symbol?: Symbol) =>
    (node: VariableDeclaration): DiagnosticResult<SymbolDef> => {
        const $asParseError = (msg: string) => E.left(makeParseError(node)(msg));

        const declKind = node.getVariableStatement()?.getDeclarationKind();
        if (!declKind) return $asParseError("failed to get DeclarationKind");
        if (declKind !== VariableDeclarationKind.Const)
            return $asParseError(`${declKind} VariableDeclaration not implemented`);

        return pipe(
            node,
            parseConstVariableDeclaration(symbol),
        )
    }

const parseVariableStatement = (node: VariableStatement): DiagnosticResult<readonly SymbolDef[]> => pipe(
    node.getDeclarations(),
    ROA.map(flow(parseVariableDeclaration(), E.map(ROA.of))),
    M.concatAll(getResultMonoid(ROA.getMonoid<SymbolDef>()))
);

const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\} ([_a-zA-Z0-9]+)/

const parseMethodToken = (node: FunctionDeclaration) =>
    (tag: JSDocTag): DiagnosticResult<sc.MethodToken> => {
        const matches = tag.getCommentText()?.match(regexMethodToken) ?? [];
        if (matches.length !== 3) return E.left(makeParseError(node)(`invalid method token tag comment ${tag.getCommentText()}`));
        const hash = u.HexString.fromHex(matches[1], true);

        // TODO: should we support specifying call flags in tag comment?
        const callFlags = sc.CallFlags.All
        const token = new sc.MethodToken({
            hash: hash.toString(),
            method: matches[2],
            parametersCount: node.getParameters().length,
            hasReturnValue: !isVoidLike(node.getReturnType()),
            callFlags
        });
        return E.right(token);
    }

const regexOperation = /(\S+)\s?(\S+)?/

const $parseOperation = (node: Node) =>
    (comment: string): DiagnosticResult<Operation> => {
        const matches = comment.match(regexOperation) ?? [];
        const error = makeParseError(node)(`invalid method token tag comment "${comment}"`);
        return matches.length === 3
            ? pipe(
                parseOperation(matches[1], matches[2]),
                E.fromNullable(error))
            : E.left(error);
    }

interface DeclareFunctionDeclarationOptions {
    readonly symbol: Symbol,
    readonly tags: RONEA.ReadonlyNonEmptyArray<JSDocTag>
}

const parseDeclareFunctionDeclaration = (node: FunctionDeclaration) =>
    ({ symbol, tags }: DeclareFunctionDeclarationOptions): DiagnosticResult<SymbolDef> => {
        const head = RONEA.head(tags);
        switch (head.getTagName()) {
            case 'event':
                return isVoidLike(node.getReturnType())
                    ? E.right(new EventSymbolDef(symbol, head.getCommentText() ?? symbol.getName(), node.getParameters()))
                    : E.left(makeParseError(node)('event functions cannot have return values'));
            case 'methodToken':
                return pipe(head,
                    parseMethodToken(node),
                    E.map(token => new MethodTokenSymbolDef(symbol, token)));
            case 'operation':
                return pipe(tags,
                    ROA.filter(t => t.getTagName() === 'operation'),
                    ROA.map(flow(
                        t => t.getCommentText(),
                        E.fromNullable(makeParseError(node)("missing operation JSDoc tag comment")),
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
                return E.left(makeParseError(node)(`invalid function declaration tag ${head.getTagName()}`));
        }
    }

class InterfaceSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly node: InterfaceDeclaration,
    ) { }
}

const parseInterfaceDeclaration = (symbol?: Symbol) =>
    (node: InterfaceDeclaration): DiagnosticResult<SymbolDef> => pipe(
        node,
        parseSymbol(symbol),
        E.map(s => new InterfaceSymbolDef(s, node))
    );

class FunctionSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly node: FunctionDeclaration,
    ) { }
}

const parseFunctionDeclaration = (symbol?: Symbol) =>
    (node: FunctionDeclaration): DiagnosticResult<SymbolDef> => node.hasDeclareKeyword()
        ? pipe(
            node.getJsDocs(),
            ROA.head,
            O.map(d => pipe(d.getTags(), RONEA.fromArray)),
            O.flatten,
            E.fromOption(() => makeParseError(node)('declared functions must have a JSDoc block tag')),
            E.bindTo('tags'),
            E.bind('symbol', () => pipe(node, parseSymbol(symbol))),
            E.chain(parseDeclareFunctionDeclaration(node))
        )
        : pipe(node,
            parseSymbol(symbol),
            E.map(s => new FunctionSymbolDef(s, node))
        );

const parseImportSpecifier = ($module: SourceFile) =>
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
                if (Node.isFunctionDeclaration(node)) return pipe(node, parseFunctionDeclaration(symbol));
                if (Node.isVariableDeclaration(node)) return pipe(node, parseVariableDeclaration(symbol));
                if (Node.isInterfaceDeclaration(node)) return pipe(node, parseInterfaceDeclaration(symbol));
                return E.left(makeParseError(node)(`parseImportSpecifier ${node.getKindName()}`));
            })
        );
    }

function parseImportDeclaration(node: ImportDeclaration): DiagnosticResult<readonly SymbolDef[]> {
    const $module = node.getModuleSpecifierSourceFile();
    if (!$module) return E.left(makeParseError(node)(`parseImportDeclaration getModuleSpecifierSourceFile failed`));

    return pipe(
        node.getNamedImports(),
        ROA.map(flow(
            parseImportSpecifier($module),
            E.map(ROA.of))),
        M.concatAll(getResultMonoid(ROA.getMonoid<SymbolDef>()))
    );
}

function parseSourceFile(src: SourceFile): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> {
    const children = src.forEachChildAsArray();
    const { left: errors, right: defs } = pipe(
        children,
        ROA.map(node => {
            if (Node.isFunctionDeclaration(node)) return pipe(node, parseFunctionDeclaration(), E.map(ROA.of));
            if (Node.isImportDeclaration(node)) return parseImportDeclaration(node);
            if (Node.isVariableStatement(node)) return parseVariableStatement(node);
            if (Node.isInterfaceDeclaration(node)) return pipe(node, parseInterfaceDeclaration(), E.map(ROA.of));
            if (node.getKind() == SyntaxKind.EndOfFileToken) return E.right([]);
            return E.left(makeParseError(node)(`parseSourceFileSymbols ${node.getKindName()}`));
        }),
        ROA.partitionMap(q => q)
    )

    return (errors.length > 0)
        ? E.left(errors)
        : E.right(pipe(defs,
            M.concatAll(ROA.getMonoid<SymbolDef>())));
}

export const parseProject = (project: Project) => pipe(
    project.getSourceFiles(),
    ROA.filter(s => !s.isDeclarationFile()),
    ROA.map(parseSourceFile),
);