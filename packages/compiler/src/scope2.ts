import { Node, VariableStatement, VariableDeclarationKind, SourceFile, Project, Symbol, VariableDeclaration, Expression, SyntaxKind, BigIntLiteral, NumericLiteral, StringLiteral } from "ts-morph";
import { flow, pipe, Lazy } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import { $resolve, ConstantSymbolDef, ReadonlyScope, SymbolDef } from "./scope";
import { getConstantValue } from "./utils";
import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";
import * as S from "fp-ts/lib/Semigroup";

interface ParseError { message: string, node?: Node  }
type DiagnosticResult<T> = E.Either<ParseError, T>;

const asParseError = (node?: Node) => (e: string | unknown): ParseError => {
    const message = e instanceof Error ? e.message : String(e);
    return { message, node };
}

const tryCatch = (node?: Node) => <T>(f: Lazy<T>): DiagnosticResult<T> => E.tryCatch(f, asParseError(node));

const getSymbol = (symbol?: Symbol) => (node: Node) => pipe(
    symbol, 
    O.fromNullable,
    O.match(
        () => tryCatch(node)(node.getSymbolOrThrow),
        (s) => E.right(s)
    )
)

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
                : E.left(asParseError(node)(`invalid non-integer numeric literal {literal}`));
        }
        case SyntaxKind.StringLiteral: {
            const literal = (node as StringLiteral).getLiteralValue();
            return tryCatch(node)(() => Buffer.from(literal, 'utf8') as ReadonlyUint8Array)
        }
        // case tsm.SyntaxKind.ArrayLiteralExpression: 
        // case tsm.SyntaxKind.ObjectLiteralExpression:
        default:
            return E.left(asParseError(node)(`Unsupported const type ${node.getKindName()}`));
    }

}


const parseConstVariableDeclaration = (symbol?: Symbol) => (node: VariableDeclaration): DiagnosticResult<SymbolDef> => 
    pipe(
        node.getInitializer(),
        O.fromNullable,
        E.fromOption(() => asParseError(node)("missing initializer")),
        E.map(parseConstantValue),
        E.flatten,
        E.bindTo("value"),
        E.bind("symbol", () => pipe(node, getSymbol(symbol))),
        E.chain(({value, symbol}) => E.right(new ConstantSymbolDef(symbol, value)))
    );

const createResultSemigroup = <T>(sg: S.Semigroup<T>): S.Semigroup<DiagnosticResult<T>> => E.getSemigroup<ParseError, T>(sg);
const createResultMonoid = <T>(monoid: M.Monoid<T>): M.Monoid<DiagnosticResult<T>> =>({
    concat: createResultSemigroup(monoid).concat,
    empty: E.right(monoid.empty)
});

function parseVariableStatement(node: VariableStatement): DiagnosticResult<readonly SymbolDef[]> {
    const declKind = node.getDeclarationKind();
    if (declKind !== VariableDeclarationKind.Const)
        return E.left(asParseError(node)(`${declKind} var decl not implemented`));

    return pipe(
        node.getDeclarations(),
        ROA.map(parseConstVariableDeclaration()),
        ROA.map(E.map(ROA.of)),
        M.concatAll(createResultMonoid(ROA.getMonoid<SymbolDef>()))
    );
}

function parseNodeScope(node: Node) {
    // if (Node.isFunctionDeclaration(node)) return parseFunctionDeclaration(node);
    if (Node.isVariableStatement(node)) return parseVariableStatement(node);

}

// [tsm.SyntaxKind.FunctionDeclaration]: processFunctionDeclaration,
// [tsm.SyntaxKind.InterfaceDeclaration]: processInterfaceDeclaration,
// [tsm.SyntaxKind.ImportDeclaration]: processImportDeclaration,
// [tsm.SyntaxKind.VariableDeclaration]: processVariableDeclaration,
// [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
// [tsm.SyntaxKind.EndOfFileToken]: () => { },


function createROScope(map: ReadonlyMap<Symbol, SymbolDef>, parentScope?: ReadonlyScope): ReadonlyScope {
    return {
        parentScope,
        symbols: map.values(),
        resolve: (symbol) => $resolve(map, symbol, parentScope)
    }

}

function parseSourceFileScope(src: SourceFile): DiagnosticResult<ReadonlyScope> {
    if (src.isDeclarationFile()) return E.right(createROScope(new Map()));


    else { src.forEachChild(parseNodeScope);}

    return E.left({ message: 'not implemented', node: src });
}

export function parseProjectScope(project: Project) {

    const sources = project.getSourceFiles();
    const q = pipe(
        sources,
        ROA.map(parseSourceFileScope),
    )
    

    // pipe(srcs, ROA.filter())
}