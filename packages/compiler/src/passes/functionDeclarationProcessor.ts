import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as S from 'fp-ts/State';
import * as O from 'fp-ts/Option';

import { makeParseError } from "../symbolDef";
import { createEmptyScope, createScope, updateScopeSymbols } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { convertJumpTargetOps, JumpTargetOperation, Location, Operation, pushString } from "../types/Operation";
import { E_fromSeparated, isVoidLike } from "../utils";
import { ContractMethod } from "../types/CompileOptions";
import { parseSymbol } from "./parseSymbol";
import { parseExpression as $parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
import { LocalVariableSymbolDef, ParameterSymbolDef } from "./sourceSymbolDefs";

interface ParseFunctionContext {
    readonly scope: Scope;
    readonly locals: readonly LocalVariableSymbolDef[];
    readonly errors: readonly ParseError[];
}

interface ParseBodyResult {
    readonly operations: readonly Operation[];
    readonly locals: readonly LocalVariableSymbolDef[];
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

function collectBindingElements(node: tsm.BindingName): readonly (tsm.Identifier | tsm.BindingElement)[] {
    if (node instanceof tsm.Identifier) {
        return ROA.of(node);
    }
    if (node instanceof tsm.ArrayBindingPattern) {
        return pipe(
            node.getElements(),
            ROA.filter(tsm.Node.isBindingElement),
        );
    }
    if (node instanceof tsm.ObjectBindingPattern) {
        return ROA.fromArray(node.getElements());
    }
    return ROA.empty;
}

function storeArrayBindingPattern(node: tsm.ArrayBindingPattern, vars: readonly LocalVariableSymbolDef[], initOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> {

    return pipe(
        node.getElements(),
        ROA.mapWithIndex((index, element) => [element, index] as const),
        ROA.filter(([element]) => tsm.Node.isBindingElement(element)),
        ROA.map(([element, index]) => [element as tsm.BindingElement, index] as const),
        ROA.map(([element, index]) => {
            return pipe(
                element,
                findVar(vars),
                E.map(def => [element, index, def] as const)
            );
        }),
        ROA.sequence(E.Applicative),
        E.map(ROA.matchRight(
            // if there are no binding elements execute the init expression 
            // (if there is one) and drop the result
            () => ROA.isNonEmpty(initOps)
                ? ROA.append({ kind: "drop" })(initOps) as readonly Operation[]
                : ROA.empty,
            (init, last) => {
                return pipe(
                    init,
                    // for every binding element except the last one, 
                    // duplicate the init expression, pick the specified index
                    // from the array and store it in the variable
                    ROA.map(([element, index, def]) => [
                        { kind: "duplicate", location: element },
                        { kind: 'pushint', value: BigInt(index) },
                        { kind: 'pickitem' },
                        def.storeOp
                    ] as readonly Operation[]),
                    // for the last binding element, pick the specified index
                    // from the array without duplicating
                    ops => {
                        const [element, index, def] = last;
                        const lastOps: readonly Operation[] = [
                            { kind: 'pushint', value: BigInt(index), location: element },
                            { kind: 'pickitem' },
                            def.storeOp
                        ]
                        return ROA.append(lastOps)(ops);
                    },
                    ROA.flatten,
                    ops => ROA.concat(ops)(initOps)
                );
            }
        ))
    );
}

function getPropertyName(element: tsm.BindingElement): O.Option<string> {
    const propNode = element.getPropertyNameNode();
    if (tsm.Node.isIdentifier(propNode)) return O.of(propNode.getText());
    if (tsm.Node.isStringLiteral(propNode)) return O.of(propNode.getLiteralText());
    if (tsm.Node.isComputedPropertyName(propNode)) return O.of(propNode.getText());
    return O.none;
}

function storeObjectBindingPattern(node: tsm.ObjectBindingPattern, vars: readonly LocalVariableSymbolDef[], initOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> {
    return pipe(
        node.getElements(),
        ROA.map(element => pipe(
            getPropertyName(element),
            E.fromOption(() => makeParseError(element)("Expected a property name")),
            E.map(name => [element, name] as const)
        )),
        ROA.map(E.chain(([element, name]) => pipe(
            element,
            findVar(vars),
            E.map(def => [element, name, def] as const)
        ))),
        ROA.sequence(E.Applicative),
        E.map(ROA.matchRight(
            // if there are no binding elements execute the init expression 
            // (if there is one) and drop the result
            () => ROA.isNonEmpty(initOps)
                ? ROA.append({ kind: "drop" })(initOps) as readonly Operation[]
                : ROA.empty,
            (init, last) => {
                return pipe(
                    init,
                    // for every binding element except the last one, 
                    // duplicate the init expression, pick the specified key
                    // from the object and store it in the variable
                    ROA.map(([element, name, def]) => [
                        { kind: "duplicate", location: element },
                        pushString(name),
                        { kind: 'pickitem' },
                        def.storeOp
                    ] as readonly Operation[]),
                    // for the last binding element, pick the specified key
                    // from the object without duplicating
                    ops => {
                        const [element, name, def] = last;
                        const lastOps: readonly Operation[] = [
                            pushString(name, element),
                            { kind: 'pickitem' },
                            def.storeOp
                        ]
                        return ROA.append(lastOps)(ops);
                    },
                    ROA.flatten,
                    ops => ROA.concat(ops)(initOps)
                );
            },
        ))
    );
}

function storeIdentifier(node: tsm.Identifier, vars: readonly LocalVariableSymbolDef[], initOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> {
    return pipe(
        node,
        findVar(vars),
        E.chain(local => local.parseStore(ROA.empty, initOps)),
    );
}

const storeBindingName =
    (node: tsm.BindingName, vars: readonly LocalVariableSymbolDef[]) =>
        (initOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> => {
            if (node instanceof tsm.Identifier) return storeIdentifier(node, vars, initOps);
            if (node instanceof tsm.ArrayBindingPattern) return storeArrayBindingPattern(node, vars, initOps);
            if (node instanceof tsm.ObjectBindingPattern) return storeObjectBindingPattern(node, vars, initOps);
            return E.left(makeParseError(node)(`Unexpected binding name ${(node as tsm.Node).getKindName()}`));
        }

function findVar(vars: readonly LocalVariableSymbolDef[]) {
    return (node: tsm.Node) => {
        return pipe(
            node,
            parseSymbol,
            E.chain(symbol => pipe(
                vars,
                ROA.findFirst(v => v.symbol === symbol),
                E.fromOption(() => makeParseError(node)(`Could not find "${symbol.getName()} symbol`))
            ))
        );
    };
}

const parseVariableStatement =
    (node: tsm.VariableStatement): ParseStatementState =>
        context => {
            const declarations = node.getDeclarations();
            return pipe(
                // first, create LocalVariableSymbolDef for each declared binding element
                declarations,
                ROA.map(decl => decl.getNameNode()),
                ROA.chain(collectBindingElements),
                ROA.mapWithIndex((index, name) => pipe(
                    name,
                    parseSymbol,
                    E.map(symbol => {
                        return new LocalVariableSymbolDef(name, symbol, index + context.locals.length);
                    })
                )),
                ROA.separate,
                E_fromSeparated,
                E.bindTo('vars'),
                // then, parse the initializer expression for each declaration
                E.bind("ops", ({ vars }) => pipe(
                    declarations,
                    ROA.map(decl => pipe(
                        decl.getInitializer(),
                        O.fromNullable,
                        O.match(
                            () => E.of(ROA.empty),
                            init => pipe(
                                init,
                                $parseExpression(context.scope),
                                E.map(updateLocation(init)),
                                E.chain(storeBindingName(decl.getNameNode(), vars))
                            ))
                    )),
                    ROA.separate,
                    E_fromSeparated,
                    E.map(ROA.flatten)
                )),
                // update the current scope to include the new local variables
                E.bind('scope', ({ vars }) => pipe(
                    vars,
                    updateScopeSymbols(context.scope),
                    E.mapLeft(msg => ROA.of(makeParseError(node)(msg)))
                )),
                E.match(
                    errors => {
                        return [ROA.empty, {
                            ...context,
                            errors: ROA.concat(errors)(context.errors)
                        }] as [readonly Operation[], ParseFunctionContext]
                    },
                    ({ vars, ops, scope }) => {
                        const locals = ROA.concat(vars)(context.locals);
                        return [ops, { ...context, locals, scope }]
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
