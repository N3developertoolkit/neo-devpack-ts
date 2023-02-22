import * as tsm from "ts-morph";

import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as S from 'fp-ts/State';
import * as SEP from 'fp-ts/Separated';


import { makeParseError, parseSymbol as $parseSymbol, VariableSymbolDef, ParseError, createDiagnostic } from "../symbolDef";
import { $createScope, Scope } from "../scope";
import { JumpTargetOperation, Location, Operation } from "../types/Operation";
import { parseExpression as $parseExpression } from "./expressionProcessor";
import { isVoidLike } from "../utils";

type Diagnostic = tsm.ts.Diagnostic;

const parseSymbol = $parseSymbol();
const concatDiags = (diagnostics: ReadonlyArray<Diagnostic>) =>
    (errors: ReadonlyArray<ParseError>) =>
        ROA.concat(ROA.map(createDiagnostic)(errors))(diagnostics);
const appendDiag = (diagnostics: ReadonlyArray<Diagnostic>) =>
    (error: ParseError) =>
        ROA.append(createDiagnostic(error))(diagnostics);

const E_fromSeparated = <E, A>(s: SEP.Separated<ReadonlyArray<E>, A>): E.Either<ReadonlyArray<E>, A> =>
    ROA.isNonEmpty(s.left) ? E.left(s.left) : E.of(s.right)

const parseExpression =
    (node: tsm.Expression): StatementParseState =>
        (state) => {
            const [ops, errors] = $parseExpression(state.scope)(node)(state.errors);
            return [ops, { ...state, errors }]
        }

const updateLocation =
    (location: Location) =>
        (ops: ReadonlyArray<Operation>) =>
            ROA.isNonEmpty(ops)
                ? pipe(ops, RNEA.modifyHead(op => ({ ...op, location })))
                : ops;


const opsMonoid = ROA.getMonoid<Operation>();

const parseBlock =
    (node: tsm.Block): StatementParseState =>
        ($state) => {
            // create a new scope for the statements within the block
            let state = { ...$state, scope: $createScope($state.scope)([]) }
            let operations = opsMonoid.empty;

            const open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
            if (open) {
                operations = ROA.append<Operation>({ kind: 'noop', location: open })(operations);
            }

            let ops: ReadonlyArray<Operation>;
            for (const stmt of node.getStatements()) {
                [ops, state] = parseStatement(stmt)($state);
                operations = opsMonoid.concat(operations, ops);
            }

            const close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
            if (close) {
                operations = ROA.append<Operation>({ kind: 'noop', location: close })(operations);
            }

            //  keep the accumulated errors and locals, but swap the original state scope
            //  back in on return
            return [operations, { ...state, scope: $state.scope }];
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



const parseVariableStatement =
    (node: tsm.VariableStatement): StatementParseState =>
        (state) => {

            const declKind = node.getDeclarationKind();
            if (declKind === 'const') {
                return appendError(makeParseError(node)(`${declKind} not implemented`))(state);
            }

            const decls = pipe(
                node.getDeclarations(),
                ROA.mapWithIndex((i, decl) => pipe(
                    decl,
                    parseSymbol,
                    E.map(s => new VariableSymbolDef(s, 'local', i + state.locals.length)),
                    E.bindTo('def'),
                    E.bind('init', () => E.right(O.fromNullable(decl.getInitializer())))
                )),
                ROA.separate,
                E_fromSeparated,
            )

            if (E.isRight(decls)) {
                for (const d of decls.right) {

                }
            }
            //     if (E.isLeft(decls)) {
            //         return appendErrors(decls.left)(state);
            //     } else {


            //     }
            // } else {
            return appendError(makeParseError(node)(`can't declare variables in read only scope`))(state);
            // }
        }

const parseExpressionStatement =
    (node: tsm.ExpressionStatement): StatementParseState =>
        (state) => {
            const expr = node.getExpression();
            let ops: ReadonlyArray<Operation>;
            [ops, state] = parseExpression(expr)(state);
            if (!isVoidLike(expr.getType())) {
                ops = ROA.append<Operation>({ kind: 'drop' })(ops);
            }
            return [updateLocation(node)(ops), state]
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

const parseIfStatement =
    (node: tsm.IfStatement): StatementParseState =>
        (state) => {
            const qExpr = parseExpression(node.getExpression())(state);
            const qThen = parseStatement(node.getThenStatement())(state);
            const qElse = pipe(
                node.getElseStatement(),
                O.fromNullable,
                O.map(s => parseStatement(s)(state))
            );
            throw new Error();
        }

const parseReturnStatement =
    (node: tsm.ReturnStatement): StatementParseState =>
        (state) => {
            let ops = opsMonoid.empty;
            const expr = node.getExpression();
            if (expr) {
                [ops, state] = parseExpression(expr)(state);
            }
            const op: JumpTargetOperation = { kind: 'jump', target: returnOp };
            ops = ROA.append<Operation>(op)(ops);
            return [updateLocation(node)(ops), state]
        }

const parseThrowStatement =
    (node: tsm.ThrowStatement): StatementParseState =>
        (state) => {
            let ops = opsMonoid.empty;
            [ops, state] = parseExpression(node.getExpression())(state)
            ops = ROA.append<Operation>({ kind: 'throw' })(ops);
            return [updateLocation(node)(ops), state]
        }

// Sentinel returnTarget 
const returnOp: Operation = { kind: 'return' };

const appendError = (error: ParseError): StatementParseState =>
    (state) => ([[], { ...state, errors: ROA.append(error)(state.errors) }]);

const appendErrors = (error: ReadonlyArray<ParseError>): StatementParseState =>
    (state) => ([[], { ...state, errors: ROA.concat(error)(state.errors) }]);

interface FunctionParseState {
    readonly scope: Scope
    readonly locals: ReadonlyArray<tsm.VariableDeclaration>
    readonly errors: ReadonlyArray<ParseError>
}

type StatementParseState = S.State<FunctionParseState, ReadonlyArray<Operation>>

const parseStatement =
    (node: tsm.Statement): StatementParseState =>
        (state) => {
            if (tsm.Node.isBlock(node)) return parseBlock(node)(state);
            if (tsm.Node.isExpressionStatement(node)) return parseExpressionStatement(node)(state);
            if (tsm.Node.isIfStatement(node)) return parseIfStatement(node)(state);
            if (tsm.Node.isReturnStatement(node)) return parseReturnStatement(node)(state);
            if (tsm.Node.isThrowStatement(node)) return parseThrowStatement(node)(state);
            if (tsm.Node.isVariableStatement(node)) return parseVariableStatement(node)(state);
            return appendError(makeParseError(node)(`parseStatement ${node.getKindName()} not implemented`))(state);
        }

type BodyParseResult = {
    readonly operations: ReadonlyArray<Operation>,
    readonly locals: ReadonlyArray<tsm.VariableDeclaration>
}

const parseBody =
    (scope: Scope) =>
        (body: tsm.Node): E.Either<ReadonlyArray<ParseError>, BodyParseResult> => {

            if (tsm.Node.isStatement(body)) {
                const [operations, state] = parseStatement(body)({ scope, errors: [], locals: [] });
                if (ROA.isNonEmpty(state.errors)) {
                    return E.left(state.errors);
                } else {
                    return E.of({ operations, locals: state.locals })
                }
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
    (node: tsm.FunctionDeclaration) =>
        (result: BodyParseResult): E.Either<ReadonlyArray<ParseError>, ContractMethod> => {

            return pipe(
                node,
                parseSymbol,
                E.map(symbol => ({
                    name: symbol.getName(),
                    node,
                    operations: [],
                    variables: [],
                } as ContractMethod)),
                E.mapLeft(ROA.of)
            );
        }


export const parseFunctionDeclaration =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): S.State<ReadonlyArray<Diagnostic>, ContractMethod> =>
            (diagnostics) => {
                return pipe(
                    node.getParameters(),
                    ROA.mapWithIndex((index, node) => pipe(
                        node,
                        parseSymbol,
                        E.map(s => new VariableSymbolDef(s, 'local', index))
                    )),
                    ROA.separate,
                    E_fromSeparated,
                    E.map($createScope(parentScope)),
                    E.bindTo('scope'),
                    E.bind('body', () => pipe(
                        node.getBody(),
                        E.fromNullable(
                            ROA.of(
                                makeParseError(node)("undefined body")
                            )
                        )
                    )),
                    E.chain((o) => parseBody(o.scope)(o.body)),
                    E.chain(makeContractMethod(node)),
                    E.match(
                        left => [
                            { node, name: "", operations: [], variables: [] },
                            concatDiags(diagnostics)(left)
                        ],
                        right => [right, diagnostics]
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