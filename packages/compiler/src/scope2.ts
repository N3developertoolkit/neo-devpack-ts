import { Node, VariableStatement, VariableDeclarationKind, SourceFile, Project, Symbol, VariableDeclaration, Expression, SyntaxKind, BigIntLiteral, NumericLiteral, StringLiteral, FunctionDeclaration, ImportDeclaration, ImportSpecifier, JSDocTag } from "ts-morph";
import { flow, pipe, Lazy } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RONEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import { $resolve, ConstantSymbolDef, EventSymbolDef, MethodTokenSymbolDef, OperationsSymbolDef, ReadonlyScope, SymbolDef, SysCallSymbolDef } from "./scope";
import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
import * as S from "fp-ts/lib/Semigroup";
import { isVoidLike } from "./utils";
import { sc, u } from '@cityofzion/neon-core';
import { make } from "fp-ts/lib/Tree";
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
        E.chain(({ x, y }) => E.right(sg.concat(x, y)))
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
                : E.left(makeParseError(node)(`invalid non-integer numeric literal {literal}`));
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
        E.chain(({ value, symbol }) => E.right(new ConstantSymbolDef(symbol, value)))
    );

const parseVariableDeclaration = (symbol?: Symbol) =>
    (node: VariableDeclaration): DiagnosticResult<readonly SymbolDef[]> => {
        const $asParseError = (msg: string) => E.left(makeParseError(node)(msg));
        const declKind = node.getVariableStatement()?.getDeclarationKind();
        if (!declKind) return $asParseError("failed to get DeclarationKind");
        if (declKind !== VariableDeclarationKind.Const)
            return $asParseError(`${declKind} var decl not implemented`);

        return pipe(
            node,
            parseConstVariableDeclaration(symbol),
            E.map(ROA.of)
        )
    }

const parseVariableStatement = (node: VariableStatement): DiagnosticResult<readonly SymbolDef[]> => pipe(
    node.getDeclarations(),
    ROA.map(parseVariableDeclaration()),
    M.concatAll(getResultMonoid(ROA.getMonoid<SymbolDef>()))
);

class FunctionSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: Symbol,
        readonly node: FunctionDeclaration,
    ) { }
}

const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\} ([_a-zA-Z0-9]+)/

const parseMethodToken = (node: FunctionDeclaration) =>
    (tag: JSDocTag): DiagnosticResult<sc.MethodToken> => {
        const matches = tag.getCommentText()?.match(regexMethodToken) ?? [];
        if (matches.length !== 3) return E.left(makeParseError(node)("invalid method token tag comment"));
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

function $parseOperation(comment: string): O.Option<Operation> {
    const matches = comment.match(regexOperation) ?? [];
    return matches.length === 3
        ? pipe(parseOperation(matches[1], matches[2]), O.fromNullable)
        : O.none;
}

const parseOperationTags = (tags: ReadonlyArray<JSDocTag>): DiagnosticResult<ReadonlyArray<Operation>> => pipe(
    tags,
    ROA.filter(t => t.getTagName() === 'operation'),
    ROA.map(flow(
        t => t.getCommentText() ?? "",
        $parseOperation,
        O.map(ROA.of),
        E.fromOption(() => makeParseError()("invalid operation")))),
    M.concatAll(getResultMonoid(ROA.getMonoid<Operation>()))
);

const parseDeclareFunctionDeclaration = (node: FunctionDeclaration) =>
    ({ symbol, tags }: { readonly symbol: Symbol, readonly tags: RONEA.ReadonlyNonEmptyArray<JSDocTag> }): DiagnosticResult<SymbolDef> => {

        const head = RONEA.head(tags);
        switch (head.getTagName()) {
            case 'event': {
                if (!isVoidLike(node.getReturnType()))
                    return E.left(makeParseError(node)('event functions cannot have return values'));
                const eventName = head.getCommentText() ?? symbol.getName();
                return E.right(new EventSymbolDef(symbol, eventName, node.getParameters()));
            }
            case 'methodToken': {
                return pipe(head,
                    parseMethodToken(node),
                    E.map(token => new MethodTokenSymbolDef(symbol, token)));
            }
            case 'operation': {
                return pipe(tags,
                    parseOperationTags,
                    E.map(ops => new OperationsSymbolDef(symbol, ops)));
            }
            case 'syscall': {
                const serviceName = head.getCommentText() ?? "";
                return E.right(new SysCallSymbolDef(symbol, serviceName));
            }
            default:
                return E.left(makeParseError(node)(`invalid function declaration tag ${head.getTagName()}`));
        }

    }

const parseFunctionDeclaration = (symbol?: Symbol) =>
    (node: FunctionDeclaration): DiagnosticResult<SymbolDef> => {

        const $makeParseError = makeParseError(node);
        const symbolResult = pipe(node, parseSymbol(symbol));
        if (node.hasDeclareKeyword()) {
            return pipe(
                node.getJsDocs(),
                ROA.head,
                O.map(d => pipe(d.getTags(), RONEA.fromArray)),
                O.flatten,
                E.fromOption(() => $makeParseError('declared functions must have a JSDoc block tag')),
                E.bindTo('tags'),
                E.bind('symbol', () => symbolResult),
                E.chain(parseDeclareFunctionDeclaration(node))
            );
        } else {
            return pipe(
                symbolResult,
                E.map(s => new FunctionSymbolDef(s, node)));
        }
    }

const parseImportSpecifier = ($module: SourceFile) =>
    (node: ImportSpecifier): DiagnosticResult<readonly SymbolDef[]> => {

        const $asParseError = (msg: string) => E.left(makeParseError(node)(msg));

        const $exports = $module.getExportedDeclarations();
        const symbol = node.getSymbol();
        if (!symbol) return $asParseError("parseImportSpecifier getSymbol failed");
        const name = (symbol.getAliasedSymbol() ?? symbol).getName();
        const decls = $exports.get(name);
        if (!decls) return $asParseError(`${name} import not found`);
        if (decls.length !== 1) return $asParseError(`multiple exported declarations not implemented`);
        return parseNode(symbol)(decls[0]);
    }

function parseImportDeclaration(node: ImportDeclaration): DiagnosticResult<readonly SymbolDef[]> {
    const $module = node.getModuleSpecifierSourceFile();
    if (!$module) return E.left(makeParseError(node)(`parseImportDeclaration getModuleSpecifierSourceFile failed`));

    const $parseImportSpecifier = parseImportSpecifier($module);
    const monoid = getResultMonoid(ROA.getMonoid<SymbolDef>());

    let results = monoid.empty;
    for (const $import of node.getNamedImports()) {
        const q = $parseImportSpecifier($import);
        results = monoid.concat(results, q);
    }

    return results;
}

const parseNode = (symbol?: Symbol) => (node: Node): DiagnosticResult<readonly SymbolDef[]> => {
    if (Node.isFunctionDeclaration(node)) return pipe(node, parseFunctionDeclaration(symbol), E.map(ROA.of));
    if (Node.isVariableDeclaration(node)) return parseVariableDeclaration(symbol)(node);
    if (Node.isInterfaceDeclaration(node)) return E.right([]);
    return E.left(makeParseError(node)(`parseNode ${node.getKindName()}`));
}

function parseSourceFileNode(node: Node): DiagnosticResult<readonly SymbolDef[]> {
    if (Node.isFunctionDeclaration(node)) return pipe(node, parseFunctionDeclaration(), E.map(ROA.of));
    if (Node.isInterfaceDeclaration(node)) return E.right([]);
    if (Node.isImportDeclaration(node)) return parseImportDeclaration(node);
    if (Node.isVariableStatement(node)) return parseVariableStatement(node);
    if (node.getKind() == SyntaxKind.EndOfFileToken) return E.right([]);
    return E.left(makeParseError(node)(`parseSourceFileNode ${node.getKindName()}`));
}

function parseSourceFileScope(src: SourceFile): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> {
    if (src.isDeclarationFile()) return E.right([]);

    const errors = new Array<ParseError>();
    const results = new Array<SymbolDef>();
    src.forEachChild(node => {
        pipe(node,
            parseSourceFileNode,
            E.match(
                errors.push,
                r => results.push(...r)
            ));
    });

    return errors.length > 0 ? E.left(errors) : E.right(results);
}

const createScope = (parentScope?: ReadonlyScope) =>
    (symbols: ReadonlyArray<SymbolDef>): ReadonlyScope => {
        const map = new Map(symbols.map(def => [def.symbol, def]));
        return {
            parentScope,
            symbols: map.values(),
            resolve: (symbol) => $resolve(map, symbol, parentScope)
        }
    }

export function parseProjectScope(project: Project) {

    const sources = project.getSourceFiles();
    const q = pipe(
        sources,
        ROA.map(flow(
            parseSourceFileScope,
            E.map(createScope())
        )),
        // ROA.map(E.map(createScope()))
    )

    console.log();


    // pipe(srcs, ROA.filter())
}

