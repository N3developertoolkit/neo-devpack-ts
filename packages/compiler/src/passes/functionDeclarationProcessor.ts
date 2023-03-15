import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as S from 'fp-ts/State';
import * as SEP from 'fp-ts/Separated';
import * as FP from 'fp-ts'
import * as TS from "../utility/TS";

import { $SymbolDef, makeParseError } from "../symbolDef";
import { createScope, updateScope } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { convertJumpTargetOps, isJumpTargetOp, JumpOffsetOperation, JumpTargetOperation, LoadStoreOperation, Location, Operation } from "../types/Operation";
import { isVoidLike } from "../utils";
import { ContractMethod } from "../types/CompileOptions";
import { parseSymbol } from "./parseSymbol";
import { parseExpression as $parseExpression } from "./expressionProcessor";

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

class LocalVariableSymbolDef extends $SymbolDef {

    get loadOps(): readonly Operation[] {
        return [{ kind: "loadlocal", index: this.index }];
    }
    get storeOps(): readonly Operation[] {
        return [{ kind: "storelocal", index: this.index }];
    }

    constructor(
        readonly decl: tsm.VariableDeclaration,
        symbol: tsm.Symbol,
        readonly index: number
    ) {
        super(decl, symbol);
        this.type = decl.getType();
    }

    type: tsm.Type<tsm.ts.Type>;
}

class ParameterSymbolDef extends $SymbolDef {
    get loadOps() {
        return [{ kind: "loadarg", index: this.index }];
    }
    get storeOps() {
        return [{ kind: "storearg", index: this.index }];
    }

    constructor(
        readonly decl: tsm.ParameterDeclaration,
        symbol: tsm.Symbol,
        readonly index: number
    ) {
        super(decl, symbol);
    }
}

export const E_fromSeparated = <E, A>(s: SEP.Separated<readonly E[], A>): E.Either<readonly E[], A> =>
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
        (ops: readonly Operation[]) =>
            ROA.isNonEmpty(ops)
                ? pipe(ops, RNEA.modifyHead(op => ({ ...op, location })))
                : ops;

const parseBlock =
    (node: tsm.Block): ParseStatementState =>
        state => {
            // create a new scope for the statements within the block
            let $state = { ...state, scope: createScope(state.scope)([]) }

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

const parseVariableDeclarations =
    (declarations: readonly tsm.VariableDeclaration[]): ParseStatementState =>
        state => {
            // create an Either containing an array of VariableSymbolDefs and the operations
            // needed to initialize each variable
            const parseDeclsResult = pipe(
                declarations,
                ROA.mapWithIndex((index, decl) => pipe(
                    decl,
                    parseSymbol,
                    E.map(symbol => ({
                        def: new LocalVariableSymbolDef(decl, symbol, index + state.locals.length),
                        node: decl
                    }))
                )),
                ROA.separate,
                E_fromSeparated,
                E.map(ROA.map(({ node, def }) => {
                    const init = node.getInitializer();
                    let operations: readonly Operation[] = ROA.empty;
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
                scope: updateScope(state.scope)(defs as readonly SymbolDef[])
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
            [operations, state] = parseExpression(expr)(state);
            const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
            operations = updateLocation(closeParen ? { start: node, end: closeParen } : expr)(operations);

            if (!expr.getType().isBoolean()) {
                // TODO: complete falsy implementation. for now, compare to null
                operations = pipe(
                    operations,
                    ROA.append({ kind: "isnull" } as Operation),
                    ROA.append({ kind: 'not' } as Operation)
                );
            }

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
    (node: tsm.FunctionDeclaration) =>
        (scope: Scope) =>
            (body: tsm.Node): E.Either<readonly ParseError[], ParseBodyResult> => {
                if (tsm.Node.isStatement(body)) {
                    let [operations, state] = parseStatement(body)({ scope, errors: [], locals: [] });
                    if (ROA.isNonEmpty(state.errors)) {
                        return E.left(state.errors);
                    } else {
                        operations = pipe(operations,
                            // add return op at end of method
                            ROA.append(returnOp as Operation),
                            // add initslot op at start of method if there are locals or parameters
                            ops => {
                                const params = node.getParameters().length;
                                const locals = state.locals.length;
                                return (params > 0 || locals > 0)
                                    ? ROA.prepend({ kind: 'initslot', locals, params } as Operation)(ops)
                                    : ops;
                            },
                        );

                        return E.of({ operations, locals: state.locals })
                    }
                }
                return E.left(ROA.of(makeParseError(body)(`parseBody ${body.getKindName()} not implemented`)));
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

export const parseContractMethod =
    (parentScope: Scope) =>
        (node: tsm.FunctionDeclaration): E.Either<readonly ParseError[], ContractMethod> => {
            return pipe(
                node.getParameters(),
                ROA.mapWithIndex((index, node) => pipe(
                    node,
                    parseSymbol,
                    E.map(symbol => new ParameterSymbolDef(node, symbol, index))
                )),
                ROA.separate,
                E_fromSeparated,
                E.map(defs => createScope(parentScope)(defs as readonly SymbolDef[])),
                E.bindTo('scope'),
                E.bind('body', () => pipe(
                    node.getBody(),
                    E.fromNullable(makeParseError(node)("undefined body")),
                    E.mapLeft(ROA.of)
                )),
                E.chain(({body, scope}) => parseBody(node)(scope)(body)),
                E.chain(r => pipe(r, makeContractMethod(node), E.mapLeft(ROA.of))),
            );
        }
