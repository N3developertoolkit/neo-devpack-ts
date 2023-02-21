import * as tsm from "ts-morph";
import { ParserState } from "../compiler";

import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as RONEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import * as SG from "fp-ts/Semigroup";
import * as S from 'fp-ts/State';
import * as fpts from 'fp-ts';

type Diagnostic = tsm.ts.Diagnostic;

import { FunctionSymbolDef, getResultMonoid, makeParseError, parseSymbol as $parseSymbol, SymbolDef, VariableSymbolDef, ParseError, createDiagnostic } from "../symbolDef";
import { createReadonlyScope, createScope, isWritableScope, ReadonlyScope } from "../scope";
import { JumpOperation, Operation } from "../types/Operation";
import { append } from "fp-ts/lib/Array";



// interface FunctionParserModel {
//     readonly operations: ReadonlyArray<Operation>,
//     readonly locals: ReadonlyArray<tsm.VariableDeclaration>;
//     readonly jumpTargets: ReadonlyMap<JumpOperation, TargetOffset>;
//     readonly returnTarget: TargetOffset,
//     readonly diagnostics: ReadonlyArray<tsm.ts.Diagnostic>
// }

// export type FunctionParserState<T> = S.State<FunctionParserModel, T>;

// type ParseResult<T> = E.Either<ParseError, T>;
// type ParseResultS<T> = E.Either<RONEA.ReadonlyNonEmptyArray<ParseError>, T>;


const parseSymbol = $parseSymbol();
const concatDiags = (diagnostics: ReadonlyArray<Diagnostic>) =>
    (errors: ReadonlyArray<ParseError>) => ROA.concat(errors.map(createDiagnostic))(diagnostics);
const appendDiag = (diagnostics: ReadonlyArray<Diagnostic>) =>
    (error: ParseError) => ROA.append(createDiagnostic(error))(diagnostics);



function parseBlock(node: tsm.Block, scope: ReadonlyScope) {
    var open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
    //     if (open) builder.emit('noop', open);

    const blockScope = createScope(scope)([]);
    for (const stmt of node.getStatements()) {
        parseStatement(stmt, blockScope);
    }

    var close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
    //     if (close) builder.emit('noop', close);
}

// export function processVariableStatement(node: tsm.VariableStatement, options: ProcessMethodOptions): void {
//     const { builder, scope } = options;

//     if (!isWritableScope(scope)) {
//         throw new CompileError(`can't declare variables in read only scope`, node);
//     } else {
//         const decls = node.getDeclarations();
//         for (const decl of decls) {
//             const index = builder.addLocal(decl);
//             const def = new VariableSymbolDef(decl.getSymbolOrThrow(), 'local', index);
//             scope.define(def);

//             const init = decl.getInitializer();
//             if (init) {
//                 const setLocation = builder.getLocationSetter();
//                 processExpression(init, options);
//                 builder.emitStore(def.kind, def.index);
//                 setLocation(decl, init);
//             }
//         }
//     }
// }

function parseVariableStatement(node: tsm.VariableStatement, scope: ReadonlyScope) {
    // if (isWritableScope(scope)) {
    // }
    return E.right(makeParseError(node)("parseVariableStatement not implemented."));
}

// export function processExpressionStatement(node: tsm.ExpressionStatement, options: ProcessMethodOptions): void {
//     const { builder } = options;
//     const setLocation = builder.getLocationSetter();
//     const expr = node.getExpression();
//     processExpression(expr, options);
//     if (!isVoidLike(expr.getType())) { builder.emit('drop'); }
//     setLocation(node);
// }

function parseExpressionStatement(node: tsm.ExpressionStatement, scope: ReadonlyScope) {
    return E.left(makeParseError(node)(`parseExpressionStatement not implemented`));
}

// export function processIfStatement(node: tsm.IfStatement, options: ProcessMethodOptions): void {

//     const builder = options.builder;
//     const setLocation = builder.getLocationSetter();
//     const elseTarget: TargetOffset = { operation: undefined };
//     const expr = node.getExpression();
//     processExpression(expr, options);

//     const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
//     if (closeParen) setLocation(node, closeParen);
//     else setLocation(expr);
//     builder.emitJump('jumpifnot', elseTarget);
//     const $then = node.getThenStatement();
//     const $else = node.getElseStatement();
//     processStatement($then, options);
//     if ($else) {
//         const endTarget: TargetOffset = { operation: undefined };
//         builder.emitJump('jump', endTarget);
//         elseTarget.operation = builder.emit('noop').operation;
//         processStatement($else, options);
//         endTarget.operation = builder.emit('noop').operation;
//     } else {
//         elseTarget.operation = builder.emit('noop').operation;
//     }
// }


function parseIfStatement(node: tsm.IfStatement, scope: ReadonlyScope) {
    return E.left(makeParseError(node)(`parseIfStatement not implemented`));
}

// export function processReturnStatement(node: tsm.ReturnStatement, options: ProcessMethodOptions): void {

//     const builder = options.builder;
//     const setLocation = builder.getLocationSetter();
//     const expr = node.getExpression();
//     if (expr) {
//         processExpression(expr, options);
//     }
//     builder.emitJump("jump", builder.returnTarget);
//     setLocation(node);
// }


function parseReturnStatement(node: tsm.ReturnStatement, scope: ReadonlyScope) {
    return E.left(makeParseError(node)(`parseReturnStatement not implemented`));
}

// export function processThrowStatement(node: tsm.ThrowStatement, options: ProcessMethodOptions): void {

//     const { builder } = options;
//     const expr = node.getExpression();
//     const setLocation = builder.getLocationSetter();
//     processExpression(expr, options);
//     builder.emit('throw');
//     setLocation(node);
// }

function parseThrowStatement(node: tsm.ThrowStatement, scope: ReadonlyScope) {
    return E.left(makeParseError(node)(`parseThrowStatement not implemented`));
}

function parseStatement(node: tsm.Statement, scope: ReadonlyScope) {
    if (tsm.Node.isBlock(node)) return parseBlock(node, scope);
    if (tsm.Node.isExpressionStatement(node)) return parseExpressionStatement(node, scope);
    if (tsm.Node.isIfStatement(node)) return parseIfStatement(node, scope);
    if (tsm.Node.isReturnStatement(node)) return parseReturnStatement(node, scope);
    if (tsm.Node.isThrowStatement(node)) return parseThrowStatement(node, scope);
    if (tsm.Node.isVariableStatement(node)) return parseVariableStatement(node, scope);
    return E.left(makeParseError(node)(`parseStatement ${node.getKindName()} not implemented`));
}

// const parseBody = ({ scope, body: node }: {
//     readonly scope: ReadonlyScope;
//     readonly body: tsm.Node<tsm.ts.Node>;
// }) => {
//     if (tsm.Node.isStatement(node)) return parseStatement(node, scope)
//     return E.left(makeParseError(node)(`parseBody ${node.getKindName} not implemented`));
// }


export interface TargetOffset {
    operation: Operation | undefined
}

interface FunctionParserState {
    readonly operations: ReadonlyArray<Operation>,
    readonly locals: ReadonlyArray<tsm.VariableDeclaration>;
    readonly jumpTargets: ReadonlyMap<JumpOperation, TargetOffset>;
    readonly returnTarget: TargetOffset,
    readonly diagnostics: ReadonlyArray<tsm.ts.Diagnostic>
}

// const parseBody =
//     (scope: ReadonlyScope) =>
//         (node: tsm.Node): E.Either<ReadonlyArray<ParseError>, FunctionParserState> => {
//             if (tsm.Node.isStatement(node)) { } //return parseStatement(node, scope)
//             return E.left([makeParseError(node)(`parseBody ${node.getKindName} not implemented`)]);
//         }


const parseBody =
    (scope: ReadonlyScope) =>
        (body: tsm.Node): E.Either<ReadonlyArray<ParseError>, FunctionParserState> => {

            const state: FunctionParserState = {
                diagnostics: [],
                jumpTargets: new Map(),
                locals: [],
                operations: [],
                returnTarget: { operation: undefined }
            }

            if (tsm.Node.isStatement(body)) {
            }
            return E.left(ROA.of(makeParseError(body)(`parseBody ${body.getKindName()} not implemented`)));
        }

export interface ContractMethod {
    name: string,
    node: tsm.FunctionDeclaration,
    operations: ReadonlyArray<Operation>,
    variables: ReadonlyArray<{ name: string, type: tsm.Type }>,
}

const makeContractMethod =
    (def: FunctionSymbolDef) =>
        (parseState: FunctionParserState): E.Either<ReadonlyArray<ParseError>, ContractMethod> => {
            const method: ContractMethod = {
                name: def.symbol.getName(),
                node: def.node,
                operations: [],
                variables: [],
            };

            return E.right(method);
        }

export const parseFunctionDeclaration =
    (parentScope: ReadonlyScope) =>
        (def: FunctionSymbolDef): S.State<ReadonlyArray<Diagnostic>, O.Option<ContractMethod>> =>
            (diagnostics) => {
                return pipe(
                    def.node.getParameters(),
                    ROA.mapWithIndex((index, node) => pipe(
                        node,
                        parseSymbol,
                        E.map(s => new VariableSymbolDef(s, 'local', index))
                    )),
                    ROA.separate,
                    a => ROA.isEmpty(a.left) ? E.right(a.right) : E.left(a.left),
                    E.map(createReadonlyScope(parentScope)),
                    E.bindTo('scope'),
                    E.bind('body', () => pipe(
                        def.node.getBody(),
                        E.fromNullable(
                            ROA.of(makeParseError(def.node)("undefined body")))
                    )),
                    E.chain(o => parseBody(o.scope)(o.body)),
                    E.chain(makeContractMethod(def)),
                    E.match(
                        left => [O.none, concatDiags(diagnostics)(left)],
                        right => [O.some(right), diagnostics]
                    )
                );
            }


// export const parseSourceFileDefs =
//     (parentScope: ReadonlyScope) =>
//         (defs: ReadonlyArray<SymbolDef>): ParserState<any> =>
//             (diagnostics: ReadonlyArray<Diagnostic>) => {

//                 for (const def of defs) {
//                     if (def instanceof FunctionSymbolDef && !def.$import) {

//                         const pp = pipe(
//                             def.node.getParameters(),
//                             ROA.mapWithIndex((index, node) => pipe(
//                                 node.getSymbol(),
//                                 E.fromNullable(makeParseError(node)("undefined symbol")),
//                                 E.map(symbol => ROA.of(new VariableSymbolDef(symbol, 'arg', index))),
//                             )),
//                             M.concatAll(
//                                 getResultMonoid(
//                                     ROA.getMonoid<VariableSymbolDef>())),
//                             E.map(createReadonlyScope(parentScope))

//                         )



//                     }
//                 }


//                 return [42, diagnostics]
//             }