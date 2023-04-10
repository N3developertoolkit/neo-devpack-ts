import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as S from 'fp-ts/State';

import { makeParseError } from "../symbolDef";
import { createEmptyScope, createScope } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { convertJumpTargetOps, JumpTargetOperation, Location, Operation, updateLocation } from "../types/Operation";
import { E_fromSeparated, isVoidLike } from "../utils";
import { ContractMethod, ContractSlot } from "../types/CompileOptions";
import { parseSymbol } from "./parseSymbol";
import { parseExpression as $parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
import { LocalVariableSymbolDef, ParameterSymbolDef } from "./sourceSymbolDefs";
import { handleVariableStatement } from "./variableStatementProcessor";

interface ParseFunctionContext {
    readonly scope: Scope;
    readonly locals: readonly ContractSlot[];
    readonly errors: readonly ParseError[];
}

interface ParseBodyResult {
    readonly operations: readonly Operation[];
    readonly locals: readonly ContractSlot[];
}

type ParseStatementState = S.State<ParseFunctionContext, readonly Operation[]>

const parseExpressionState =
    (parseFunc: (scope: Scope) => (node: tsm.Expression) => E.Either<ParseError, readonly Operation[]>) =>
        (node: tsm.Expression): ParseStatementState =>
            state => {
                return pipe(
                    node,
                    parseFunc(state.scope),
                    E.match(
                        error => [[], {
                            ...state,
                            errors: ROA.append(error)(state.errors)
                        }],
                        ops => [ops, state]
                    )
                )

            }

const parseExpression = parseExpressionState($parseExpression);

const parseBlock =
    (node: tsm.Block): ParseStatementState =>
        state => {
            // create a new scope for the statements within the block
            let $state = { ...state, scope: createEmptyScope(state.scope) }

            let operations: readonly Operation[] = ROA.empty;
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

const parseVariableStatement =
    (node: tsm.VariableStatement): ParseStatementState =>
        context => {

            const factory = (element: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) =>
                new LocalVariableSymbolDef(element, symbol, index + context.locals.length);

            return pipe(
                node,
                handleVariableStatement(context.scope)(factory),
                E.match(
                    errors => [ROA.empty, { ...context, errors: ROA.concat(errors)(context.errors) }],
                    ([scope, defs, ops]) => {
                        const locals = pipe(
                            defs,
                            ROA.map(d => ({ name: d.symbol.getName(), type: d.type } as ContractSlot)),
                            vars => ROA.concat(vars)(context.locals)
                        )
                        return [ops, { ...context, locals, scope }];
                    }
                )
            );
        }

const parseExpressionStatement =
    (node: tsm.ExpressionStatement): ParseStatementState =>
        state => {
            const expr = node.getExpression();
            let ops: readonly Operation[];
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
            let operations: readonly Operation[];
            [operations, state] = parseExpressionState(parseExpressionAsBoolean)(expr)(state);
            const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
            operations = updateLocation(closeParen ? { start: node, end: closeParen } : expr)(operations);

            let $thenOps: readonly Operation[];
            [$thenOps, state] = parseStatement(node.getThenStatement())(state);
            const thenOps = ROA.append({ kind: 'noop' } as Operation)($thenOps);

            const $else = node.getElseStatement();
            if ($else) {
                let $elseOps: readonly Operation[];
                [$elseOps, state] = parseStatement($else)(state);
                const elseOps = ROA.append({ kind: 'noop' } as Operation)($elseOps);

                const elseJumpOp: JumpTargetOperation = { 'kind': "jumpifnot", target: RNEA.head(elseOps) };
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
            let operations: readonly Operation[] = ROA.empty;
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
            switch (node.getKind()) {
                case tsm.SyntaxKind.Block:
                    return parseBlock(node as tsm.Block)(state);
                case tsm.SyntaxKind.ExpressionStatement:
                    return parseExpressionStatement(node as tsm.ExpressionStatement)(state);
                case tsm.SyntaxKind.IfStatement:
                    return parseIfStatement(node as tsm.IfStatement)(state);
                case tsm.SyntaxKind.ReturnStatement:
                    return parseReturnStatement(node as tsm.ReturnStatement)(state);
                case tsm.SyntaxKind.ThrowStatement:
                    return parseThrowStatement(node as tsm.ThrowStatement)(state);
                case tsm.SyntaxKind.VariableStatement:
                    return parseVariableStatement(node as tsm.VariableStatement)(state);
                default: {
                    const error = makeParseError(node)(`parseStatement ${node.getKindName()} not implemented`);
                    return [[], { ...state, errors: ROA.append(error)(state.errors) }];
                }
            }
        }

// case SyntaxKind.BreakStatement:
// case SyntaxKind.ClassDeclaration:
// case SyntaxKind.ContinueStatement:
// case SyntaxKind.DebuggerStatement:
// case SyntaxKind.DoStatement:
// case SyntaxKind.EmptyStatement:
// case SyntaxKind.EnumDeclaration:
// case SyntaxKind.ExportAssignment:
// case SyntaxKind.ExportDeclaration:
// case SyntaxKind.ForInStatement:
// case SyntaxKind.ForOfStatement:
// case SyntaxKind.ForStatement:
// case SyntaxKind.FunctionDeclaration:
// case SyntaxKind.ImportDeclaration:
// case SyntaxKind.ImportEqualsDeclaration:
// case SyntaxKind.InterfaceDeclaration:
// case SyntaxKind.LabeledStatement:
// case SyntaxKind.ModuleBlock:
// case SyntaxKind.ModuleDeclaration:
// case SyntaxKind.NotEmittedStatement:
// case SyntaxKind.SwitchStatement:
// case SyntaxKind.TryStatement:
// case SyntaxKind.TypeAliasDeclaration:
// case SyntaxKind.WhileStatement:
// case SyntaxKind.WithStatement:

// Sentinel returnTarget 
const returnOp: Operation = { kind: 'return' };

export const parseBody =
    (scope: Scope) =>
        (body: tsm.Node): E.Either<readonly ParseError[], ParseBodyResult> => {
            if (tsm.Node.isStatement(body)) {
                let [operations, state] = parseStatement(body)({ scope, errors: [], locals: [] });
                if (ROA.isNonEmpty(state.errors)) {
                    return E.left(state.errors);
                } else {
                    return pipe(operations,
                        // add return op at end of method
                        ROA.append(returnOp as Operation),
                        operations => E.of({ operations, locals: state.locals })
                    );
                }
            }
            const error = makeParseError(body)(`parseBody ${body.getKindName()} not implemented`)
            return E.left(ROA.of(error));
        }


const makeContractMethod =
    (node: tsm.FunctionDeclaration) =>
        (result: ParseBodyResult): E.Either<ParseError, ContractMethod> => {
            return pipe(
                result.operations,
                // map all the jump target to jump offset operations
                convertJumpTargetOps,
                E.mapLeft(makeParseError(node)),
                E.bindTo('operations'),
                E.bind('symbol', () => pipe(
                    node,
                    parseSymbol,
                    E.chain(flow(
                        // _initialize is a special function emitted by the compiler
                        // so block any function from having this name
                        E.fromPredicate(
                            sym => sym.getName() !== "_initialize",
                            sym => makeParseError(node)(`invalid contract method name "${sym.getName()}"`)
                        )
                    ))
                )),
                E.map(({ symbol, operations }) => ({
                    name: symbol.getName(),
                    node,
                    symbol,
                    operations,
                    variables: result.locals
                } as ContractMethod))
            );
        }

export const makeFunctionScope =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], Scope> => {

            return pipe(
                node.getParameters(),
                ROA.mapWithIndex((index, node) => pipe(
                    node,
                    parseSymbol,
                    E.map(symbol => new ParameterSymbolDef(node, symbol, index))
                )),
                ROA.separate,
                E_fromSeparated,
                E.chain(defs => {
                    return pipe(
                        defs as readonly SymbolDef[],
                        createScope(parentScope),
                        E.mapLeft(msg => ROA.of(makeParseError(node)(msg)))
                    );
                })
            );
        }

export const parseFunctionDeclaration =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ParseBodyResult> => {
            return pipe(
                node,
                makeFunctionScope(parentScope),
                E.bindTo('scope'),
                E.bind('body', () => pipe(
                    node.getBody(),
                    E.fromNullable(makeParseError(node)("undefined body")),
                    E.mapLeft(ROA.of)
                )),
                E.chain(({ body, scope }) => parseBody(scope)(body)),
                E.map(result => {
                    const params = node.getParameters().length;
                    const locals = result.locals.length;
                    const operations = (params > 0 || locals > 0)
                        ? ROA.prepend({ kind: 'initslot', locals, params } as Operation)(result.operations)
                        : result.operations;
                    return { ...result, operations } as ParseBodyResult;
                })
            );
        }

export const parseContractMethod =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ContractMethod> => {
            return pipe(
                node,
                parseFunctionDeclaration(parentScope),
                E.chain(flow(makeContractMethod(node), E.mapLeft(ROA.of))),
            );
        }
