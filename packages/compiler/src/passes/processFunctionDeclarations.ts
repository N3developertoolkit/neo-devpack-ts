import * as tsm from "ts-morph";

import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as S from 'fp-ts/State';
import * as SEP from 'fp-ts/Separated';
import * as FP from 'fp-ts'
import * as TS from "../utility/TS";

import { makeParseError, parseSymbol as $parseSymbol, VariableSymbolDef, ParseError, createDiagnostic, SymbolDef, FunctionSymbolDef } from "../symbolDef";
import { createScope, Scope, updateScope } from "../scope";
import { isJumpTargetOp, JumpTargetOperation, LoadStoreOperation, Location, Operation } from "../types/Operation";
import { parseExpression as $parseExpression } from "./expressionProcessor";
import { isVoidLike } from "../utils";
import { ContractMethod } from "../compiler";

type Diagnostic = tsm.ts.Diagnostic;

interface ParseFunctionContext {
    readonly scope: Scope
    readonly locals: ReadonlyArray<tsm.VariableDeclaration>
    readonly errors: ReadonlyArray<ParseError>
}

type ParseStatementState = S.State<ParseFunctionContext, ReadonlyArray<Operation>>

const parseSymbol = $parseSymbol();

const E_fromSeparated = <E, A>(s: SEP.Separated<ReadonlyArray<E>, A>): E.Either<ReadonlyArray<E>, A> =>
    ROA.isNonEmpty(s.left) ? E.left(s.left) : E.of(s.right)

const parseExpression =
    (node: tsm.Expression): ParseStatementState =>
        state => {
            return pipe(
                node,
                $parseExpression(state.scope),
                E.match(
                    error => [[], {
                        ...state,
                        errors: ROA.append(error)(state.errors)
                    }],
                    ops => [ops, state]
                )
            )
        }

const updateLocation =
    (location: Location) =>
        (ops: ReadonlyArray<Operation>) =>
            ROA.isNonEmpty(ops)
                ? pipe(ops, RNEA.modifyHead(op => ({ ...op, location })))
                : ops;

const parseBlock =
    (node: tsm.Block): ParseStatementState =>
        state => {
            // create a new scope for the statements within the block
            let $state = { ...state, scope: createScope(state.scope)([]) }

            let operations: ReadonlyArray<Operation> = ROA.empty;
            for (const stmt of node.getStatements()) {
                let ops;
                [ops, $state] = parseStatement(stmt)($state);
                operations = ROA.concat(ops)(operations);
            }

            const open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
            if (open) {
                operations = ROA.prepend({ kind: 'noop', location: open } as Operation)(operations);
            }
            const close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
            if (close) {
                operations = ROA.append({ kind: 'noop', location: close } as Operation)(operations);
            }

            //  keep the accumulated errors and locals, but swap the original state scope
            //  back in on return
            return [operations, { ...$state, scope: state.scope }];
        }

const parseVariableDeclarations =
    (declarations: ReadonlyArray<tsm.VariableDeclaration>): ParseStatementState =>
        state => {
            // create an Either containing an array of VariableSymbolDefs and the operations
            // needed to initialize each variable
            const parseDeclsResult = pipe(
                declarations,
                ROA.mapWithIndex((index, decl) => pipe(
                    decl,
                    parseSymbol,
                    E.map(symbol => ({
                        def: new VariableSymbolDef(symbol, 'local', index + state.locals.length),
                        node: decl
                    }))
                )),
                ROA.separate,
                E_fromSeparated,
                E.map(ROA.map(({ node, def }) => {
                    const init = node.getInitializer();
                    let operations: ReadonlyArray<Operation> = ROA.empty;
                    if (init) {
                        [operations, state] = parseExpression(init)(state);
                        const op: LoadStoreOperation = { kind: "storelocal", index: def.index };
                        operations = ROA.append<Operation>(op)(operations);
                    }
                    operations = updateLocation(node)(operations);
                    return { operations, def: def }
                }))
            )

            // bail out if there were any issues parsing the declarations
            if (E.isLeft(parseDeclsResult)) return appendErrors(parseDeclsResult.left)(state);

            // concat all the initialization instructions 
            const operations = FP.monoid.concatAll(ROA.getMonoid<Operation>())(parseDeclsResult.right.map(o => o.operations))

            // update the current scope with the new declarations
            const defs = parseDeclsResult.right.map(o => o.def);
            state = {
                ...state,
                locals: ROA.concat(declarations)(state.locals),
                scope: updateScope(state.scope)(defs)
            };

            return [operations, state];
        }

const parseVariableStatement =
    (node: tsm.VariableStatement): ParseStatementState =>
        state => {
            const declarations = node.getDeclarations();
            return parseVariableDeclarations(declarations)(state);
        }

const parseExpressionStatement =
    (node: tsm.ExpressionStatement): ParseStatementState =>
        state => {
            const expr = node.getExpression();
            let ops: ReadonlyArray<Operation>;
            [ops, state] = parseExpression(expr)(state);

            // The store command should be *here* not in the expression parser!
            if (!isVoidLike(expr.getType())) {
                ops = ROA.append<Operation>({ kind: 'drop' })(ops);
            }
            return [updateLocation(node)(ops), state]
        }

const parseIfStatement =
    (node: tsm.IfStatement): ParseStatementState =>
        state => {
            const expr = node.getExpression();

            let operations: ReadonlyArray<Operation>;
            [operations, state] = parseExpression(expr)(state);
            const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
            operations = updateLocation(closeParen ? { start: node, end: closeParen } : expr)(operations);

            let $thenOps: ReadonlyArray<Operation>;
            [$thenOps, state] = parseStatement(node.getThenStatement())(state);
            const thenOps = ROA.append({ kind: 'noop' } as Operation)($thenOps);

            const $else = node.getElseStatement();
            if ($else) {
                const elseJumpOp: JumpTargetOperation = { 'kind': "jumpifnot", target: RNEA.last(thenOps) };

                let $elseOps: ReadonlyArray<Operation>;
                [$elseOps, state] = parseStatement(node.getThenStatement())(state);
                const elseOps = ROA.append({ kind: 'noop' } as Operation)($elseOps);
                const endJumpOp: JumpTargetOperation = { 'kind': "jump", target: RNEA.last(elseOps) };

                operations = pipe(
                    operations,
                    ROA.append(elseJumpOp as Operation),
                    ROA.concat(thenOps),
                    ROA.append(endJumpOp as Operation),
                    ROA.concat(elseOps)
                )
            } else {
                const jumpOp: JumpTargetOperation = { 'kind': "jumpifnot", target: RNEA.last(thenOps) };
                operations = pipe(
                    operations,
                    ROA.append(jumpOp as Operation),
                    ROA.concat(thenOps),
                );
            }

            return [operations, state];
        }

const parseReturnStatement =
    (node: tsm.ReturnStatement): ParseStatementState =>
        state => {
            let operations: ReadonlyArray<Operation> = ROA.empty;
            const expr = node.getExpression();
            if (expr) {
                [operations, state] = parseExpression(expr)(state);
            }
            const op: JumpTargetOperation = { kind: 'jump', target: returnOp };
            operations = pipe(operations, ROA.append(op as Operation));
            return [updateLocation(node)(operations), state]
        }

const parseThrowStatement =
    (node: tsm.ThrowStatement): ParseStatementState =>
        state => {
            let operations;
            [operations, state] = parseExpression(node.getExpression())(state)
            operations = pipe(operations, ROA.append({ kind: 'throw' } as Operation));
            return [updateLocation(node)(operations), state]
        }

const parseStatement =
    (node: tsm.Statement): ParseStatementState =>
        state => {
            if (tsm.Node.isBlock(node)) return parseBlock(node)(state);
            if (tsm.Node.isExpressionStatement(node)) return parseExpressionStatement(node)(state);
            if (tsm.Node.isIfStatement(node)) return parseIfStatement(node)(state);
            if (tsm.Node.isReturnStatement(node)) return parseReturnStatement(node)(state);
            if (tsm.Node.isThrowStatement(node)) return parseThrowStatement(node)(state);
            if (tsm.Node.isVariableStatement(node)) return parseVariableStatement(node)(state);
            return appendError(makeParseError(node)(`parseStatement ${node.getKindName()} not implemented`))(state);
        }

// Sentinel returnTarget 
const returnOp: Operation = { kind: 'return' };

const appendError = (error: ParseError): ParseStatementState =>
    state => ([[], { ...state, errors: ROA.append(error)(state.errors) }]);

const appendErrors = (error: ReadonlyArray<ParseError>): ParseStatementState =>
    state => ([[], { ...state, errors: ROA.concat(error)(state.errors) }]);

type ParseBodyResult = {
    readonly operations: ReadonlyArray<Operation>,
    readonly locals: ReadonlyArray<tsm.VariableDeclaration>
}

const parseBody =
    (scope: Scope) =>
        (body: tsm.Node): E.Either<ReadonlyArray<ParseError>, ParseBodyResult> => {
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

const convertJumpTargetOps =
    (ops: ReadonlyArray<Operation>) =>
        (jumpTargetOps: ReadonlyArray<{ index: number; op: JumpTargetOperation; }>): O.Option<ReadonlyArray<Operation>> => {
            return pipe(
                jumpTargetOps,
                ROA.matchLeft(
                    () => O.some(ops),
                    (head, tail) => pipe(
                        ops,
                        ROA.findIndex($o => head.op.target === $o),
                        O.chain(targetIndex => pipe(
                            ops,
                            ROA.modifyAt(head.index, () => ({
                                kind: head.op.kind,
                                offset: targetIndex - head.index,
                                location: head.op.location,
                            } as Operation))
                        )),
                        O.chain(ops => convertJumpTargetOps(ops)(tail))
                    )
                )
            )
        }

const makeContractMethod =
    (node: tsm.FunctionDeclaration) =>
        (result: ParseBodyResult): E.Either<ParseError, ContractMethod> => {
            const ops = pipe(result.operations,
                // add return op at end of method
                ROA.append(returnOp as Operation),
                // add initslot op at start of method if there are locals or parameters
                ops => {
                    const params = node.getParameters().length;
                    const locals = result.locals.length;
                    return (params > 0 || locals > 0)
                        ? pipe(ops, ROA.prepend({ kind: 'initslot', locals, params } as Operation))
                        : ops;
                },
            );

            return pipe(
                ops,
                // map all the jump target to jump offset operations
                ROA.filterMapWithIndex(
                    (index, op) => isJumpTargetOp(op)
                        ? O.some({ op, index })
                        : O.none),
                convertJumpTargetOps(ops),
                E.fromOption(() => makeParseError()('woops')),
                E.bindTo('operations'),
                E.bind('symbol', () => pipe(node, parseSymbol)),
                E.bind('variables', () => pipe(
                    result.locals,
                    ROA.map(varDecl => {
                        return pipe(
                            varDecl,
                            parseSymbol,
                            E.map(s => ({
                                name: s.getName(),
                                type: varDecl.getType(),
                            }))
                        );
                    }),
                    ROA.sequence(E.Applicative),
                )),
                E.map(({ symbol, operations, variables }) => ({
                    node,
                    symbol,
                    operations,
                    variables
                } as ContractMethod))
            );
        }

export const parseFunctionDeclaration =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): S.State<ReadonlyArray<Diagnostic>, ContractMethod> =>
            diagnostics => {
                return pipe(
                    node.getParameters(),
                    ROA.mapWithIndex((index, node) => pipe(
                        node,
                        parseSymbol,
                        E.map(s => new VariableSymbolDef(s, 'arg', index))
                    )),
                    ROA.sequence(E.Applicative),
                    E.mapLeft(ROA.of),
                    E.map(createScope(parentScope)),
                    E.bindTo('scope'),
                    E.bind('body', () => pipe(
                        node.getBody(),
                        E.fromNullable(makeParseError(node)("undefined body")),
                        E.mapLeft(ROA.of)
                    )),
                    E.chain(o => parseBody(o.scope)(o.body)),
                    E.chain(r => pipe(r, makeContractMethod(node), E.mapLeft(ROA.of))),
                    E.match(
                        errors => [
                            { node, symbol: node.getSymbol()!, operations: [], variables: [] },
                            ROA.concat(ROA.map(createDiagnostic)(errors))(diagnostics)
                        ],
                        method => [method, diagnostics]
                    )
                );
            }

export const parseFunctionDeclarations =
    (defs: ReadonlyArray<SymbolDef>, scope: Scope): S.State<ReadonlyArray<Diagnostic>, ReadonlyArray<ContractMethod>> =>
        diagnostics => {

            const $scope = createScope(scope)(defs);

            const functionDefs = pipe(defs,
                ROA.filterMap(def => def instanceof FunctionSymbolDef && !def.$import
                    ? O.some(def) : O.none)
            );

            let methods: ReadonlyArray<ContractMethod> = ROA.empty;
            for (const def of functionDefs) {
                let method: ContractMethod;
                [method, diagnostics] = parseFunctionDeclaration($scope)(def.node)(diagnostics);
                methods = ROA.append(method)(methods);
            }
            return [methods, diagnostics];
        }
