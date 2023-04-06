import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as S from 'fp-ts/State';
import * as O from 'fp-ts/Option';
import * as MONOID from 'fp-ts/Monoid'

import { makeParseError } from "../symbolDef";
import { createEmptyScope, createScope, updateScopeSymbols } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { convertJumpTargetOps, JumpTargetOperation, LoadStoreOperation, Location, Operation } from "../types/Operation";
import { E_fromSeparated, isVoidLike } from "../utils";
import { ContractMethod } from "../types/CompileOptions";
import { parseSymbol } from "./parseSymbol";
import { parseExpression as $parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
import { LocalVariableSymbolDef, ParameterSymbolDef } from "./sourceSymbolDefs";

interface ParseFunctionContext {
    readonly scope: Scope;
    readonly locals: readonly tsm.VariableDeclaration[];
    readonly errors: readonly ParseError[];
}

interface ParseBodyResult {
    readonly operations: readonly Operation[];
    readonly locals: readonly tsm.VariableDeclaration[];
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

const updateLocation =
    (location: Location) =>
        (ops: readonly Operation[]) =>
            ROA.isNonEmpty(ops)
                ? pipe(ops, RNEA.modifyHead(op => ({ ...op, location })))
                : ops;

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

const parseVariableDeclarationName = (node: tsm.BindingName)    => {
    if (node instanceof tsm.Identifier) {
        console.log();

    }

    

    

    if (node instanceof tsm.ArrayBindingPattern) {
        const elements = node.getElements();
        console.log();

    }

    if (node instanceof tsm.ObjectBindingPattern) {
        const elements = node.getElements();
        console.log();

    }

    return E.left(makeParseError(node)("Unexpected binding name"));
}   

const parseVariableDeclaration =
    (context: ParseFunctionContext) =>
        (index: number, decl: tsm.VariableDeclaration): E.Either<ParseError, {
            def: LocalVariableSymbolDef;
            operations: readonly Operation[];
        }> => {
            const q  = parseVariableDeclarationName(decl.getNameNode());
            return pipe(
                decl,
                parseSymbol,
                E.chain(symbol => {
                    const def = new LocalVariableSymbolDef(decl, symbol, index + context.locals.length);
                    return pipe(
                        decl.getInitializer(),
                        O.fromNullable,
                        O.map(flow(
                            $parseExpression(context.scope),
                            E.map(ops => ROA.append({ kind: "storelocal", index: def.index } as Operation)(ops)),
                            E.map(updateLocation(decl))
                        )),
                        O.match(
                            () => E.of(ROA.empty),
                            identity
                        ),
                        E.map(operations => ({ def, operations }))
                    )
                }),
            )
        }

const parseVariableStatement =
    (node: tsm.VariableStatement): ParseStatementState =>
        state => {
            const declarations = node.getDeclarations();
            return pipe(
                declarations,
                ROA.mapWithIndex((index, decl) => parseVariableDeclaration(state)(index, decl)),
                ROA.separate,
                E_fromSeparated,
                E.chain(results => {

                    const operations = MONOID.concatAll(ROA.getMonoid<Operation>())(results.map(r => r.operations));
                    const defs = results.map(r => r.def);
                    const locals = ROA.concat(declarations)(state.locals);
                    return pipe(
                        defs,
                        updateScopeSymbols(state.scope),
                        E.mapLeft(msg => ROA.of(makeParseError(node)(msg))),
                        E.map(scope => {
                            return [operations, {
                                ...state,
                                locals,
                                scope,
                            }] as [readonly Operation[], ParseFunctionContext]
                        }),
                    );
                }),
                E.match(
                    errors => {
                        const context = {
                            ...state,
                            errors: ROA.concat(errors)(state.errors)
                        }
                        return [[], context] as [readonly Operation[], ParseFunctionContext]
                    },
                    identity
                )
            )
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

const appendErrors = (error: readonly ParseError[]): ParseStatementState =>
    state => ([[], { ...state, errors: ROA.concat(error)(state.errors) }]);

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
                    name: symbol.getName(),
                    node,
                    symbol,
                    operations,
                    variables
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
