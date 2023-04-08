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
import { convertJumpTargetOps, JumpTargetOperation, Location, Operation, pushInt, pushString } from "../types/Operation";
import { E_fromSeparated, isVoidLike, single } from "../utils";
import { ContractMethod, ContractSlot } from "../types/CompileOptions";
import { parseSymbol } from "./parseSymbol";
import { parseExpression as $parseExpression, parseExpressionAsBoolean } from "./expressionProcessor";
import { ConstantSymbolDef, LocalVariableSymbolDef, ParameterSymbolDef } from "./sourceSymbolDefs";

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

type VariableSymbolDef = SymbolDef & { readonly decl: tsm.Node, readonly storeOp: Operation };

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}

function reduceIdentifierBinding(
    node: tsm.Identifier,
    declKind: tsm.VariableDeclarationKind,
    factory: (element: tsm.Identifier, symbol: tsm.Symbol, index: number) => VariableSymbolDef,
    initOps: readonly Operation[]
): E.Either<ParseError, [readonly SymbolDef[], readonly Operation[]]> {
    return pipe(
        node,
        parseSymbol,
        E.chain(symbol => pipe(
            // if declKind is const and initOps is a single push operation
            // create a ConstantSymbolDef for the constant value. Otherwise,
            // create a variable using the factory
            declKind === tsm.VariableDeclarationKind.Const ? initOps : ROA.empty,
            ROA.filter(op => op.kind != 'noop'),
            single,
            O.chain(O.fromPredicate(isPushOp)),
            O.match(
                () => {
                    const def = factory(node, symbol, 0);
                    const ops = ROA.append(def.storeOp)(initOps);
                    return [[def], ops] as [readonly SymbolDef[], readonly Operation[]];
                },
                op => {
                    const def = new ConstantSymbolDef(node, symbol, op);
                    return [[def], []] as [readonly SymbolDef[], readonly Operation[]];
                }
            ),
            v => E.of<ParseError, [readonly SymbolDef[], readonly Operation[]]>(v)
        )),
    )
}

function reduceArrayBindingPattern(
    node: tsm.ArrayBindingPattern,
    factory: (element: tsm.BindingElement, symbol: tsm.Symbol, index: number) => VariableSymbolDef,
    initOps: readonly Operation[]
): E.Either<ParseError, [readonly VariableSymbolDef[], readonly Operation[]]> {
    return pipe(
        node.getElements(),
        ROA.mapWithIndex((index, element) => [element, index] as const),
        // filter out all the omitted elements
        ROA.filter(([element]) => tsm.Node.isBindingElement(element)),
        ROA.map(([element, index]) => [element as tsm.BindingElement, index] as const),
        // create a StoreOpSymbolDef via the factory for each element
        // also return element and 
        ROA.map(([element, index]) => pipe(
            element,
            parseSymbol,
            E.map(symbol => factory(element, symbol, index)),
            E.map(def => [def as VariableSymbolDef, index] as const),
        )),
        ROA.sequence(E.Applicative),
        E.bindTo('elements'),
        E.bind('storeOps', ({ elements }) => {
            if (ROA.isNonEmpty(elements)) {
                return pipe(
                    elements,
                    RNEA.matchRight((init, last) => pipe(
                        init,
                        // for every binding element except the last one, 
                        // duplicate the init expression, pick the specified key
                        // from the object and store it in the variable
                        ROA.map(([def, index]) => [
                            { kind: "duplicate", location: def.decl },
                            pushInt(index),
                            { kind: 'pickitem' },
                            def.storeOp
                        ] as readonly Operation[]),
                        // for the last binding element, pick the specified key
                        // from the object without duplicating
                        ops => {
                            const [def, index] = last;
                            const lastOps: readonly Operation[] = [
                                pushInt(index, def.decl),
                                { kind: 'pickitem' },
                                def.storeOp
                            ];
                            return ROA.append(lastOps)(ops);
                        },
                        ROA.flatten
                    )),
                    E.of
                )
            }
            else {
                const ops = ROA.isNonEmpty(initOps) ? ROA.of({ kind: "drop" } as Operation) : ROA.empty;
                return E.of(ops);
            }
        }),
        E.map(({ elements, storeOps }) => {
            const ops = ROA.concat(storeOps)(initOps);
            const defs = pipe(elements, ROA.map(([def]) => def));
            return [defs, ops];
        })
    )
}

function reduceObjectBindingPattern(
    node: tsm.ObjectBindingPattern,
    factory: (element: tsm.BindingElement, symbol: tsm.Symbol, index: number) => VariableSymbolDef,
    initOps: readonly Operation[]
): E.Either<ParseError, [readonly VariableSymbolDef[], readonly Operation[]]> {
    return pipe(
        node.getElements(),
        // create a StoreOpSymbolDef via the factory for each element
        ROA.mapWithIndex((index, element) => pipe(
            getPropertyName(element),
            E.fromOption(() => makeParseError(element)("Expected a property name")),
            E.bindTo('name'),
            E.bind('symbol', () => pipe(element, parseSymbol)),
            E.bind('def', ({ symbol }) => E.of(factory(element, symbol, index))),
            E.map(({ name, def }) => [def, name] as const)
        )),
        ROA.sequence(E.Applicative),
        E.bindTo('elements'),
        E.bind('storeOps', ({ elements }) => {
            if (ROA.isNonEmpty(elements)) {
                return pipe(
                    elements,
                    RNEA.matchRight((init, last) => pipe(
                        init,
                        // for every binding element except the last one, 
                        // duplicate the init expression, pick the specified key
                        // from the object and store it in the variable
                        ROA.map(([def, name]) => [
                            { kind: "duplicate", location: def.decl },
                            pushString(name),
                            { kind: 'pickitem' },
                            def.storeOp
                        ] as readonly Operation[]),
                        // for the last binding element, pick the specified key
                        // from the object without duplicating
                        ops => {
                            const [def, name] = last;
                            const lastOps: readonly Operation[] = [
                                pushString(name, def.decl),
                                { kind: 'pickitem' },
                                def.storeOp
                            ];
                            return ROA.append(lastOps)(ops);
                        },
                        ROA.flatten
                    )),
                    E.of
                )
            }
            else {
                // if there are no binding elements execute the init expression 
                // (if there is one) and drop the result
                const ops = ROA.isNonEmpty(initOps)
                    ? ROA.of({ kind: "drop" } as Operation)
                    : ROA.empty;
                return E.of(ops);
            }
        }),
        E.map(({ elements, storeOps }) => {
            const ops = ROA.concat(storeOps)(initOps);
            const defs = pipe(elements, ROA.map(([def]) => def));
            return [defs, ops];
        })
    );

    function getPropertyName(element: tsm.BindingElement): O.Option<string> {
        const propNode = element.getPropertyNameNode();
        if (tsm.Node.isIdentifier(propNode)) return O.of(propNode.getText());
        return O.none;
    }
}

function reduceVariableDeclaration(
    node: tsm.BindingName,
    declKind: tsm.VariableDeclarationKind,
    factory: (element: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) => VariableSymbolDef
): (initOps: readonly Operation[]) => E.Either<ParseError, [readonly SymbolDef[], readonly Operation[]]> {
    return (initOps: readonly Operation[]) => {
        if (node instanceof tsm.Identifier)
            return reduceIdentifierBinding(node, declKind, factory, initOps);
        if (node instanceof tsm.ArrayBindingPattern)
            return reduceArrayBindingPattern(node, factory, initOps);
        if (node instanceof tsm.ObjectBindingPattern)
            return reduceObjectBindingPattern(node, factory, initOps);
        return E.left(makeParseError(node)(`Unexpected binding name ${(node as tsm.Node).getKindName()}`));
    };
}

// helper method for parsing variable statements. This is used both here for parsing local variables
// inside a function as well as in sourceFileProcessor for parsing top-level static variables
export function reduceVariableStatement(scope: Scope) {
    return (factory: (element: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) => VariableSymbolDef) =>
        (node: tsm.VariableStatement): E.Either<readonly ParseError[], readonly [Scope, readonly SymbolDef[], readonly Operation[]]> => {
            return pipe(
                node.getDeclarations(),
                ROA.map(decl => pipe(
                    decl.getInitializer(),
                    O.fromNullable,
                    O.match(
                        () => E.of(ROA.empty),
                        init => pipe(
                            init,
                            $parseExpression(scope),
                            E.map(updateLocation(init))
                        )),
                    E.chain(reduceVariableDeclaration(decl.getNameNode(), node.getDeclarationKind(), factory))
                )),
                ROA.separate,
                E_fromSeparated,
                E.chain(values => {
                    const defs = pipe(values, ROA.map(([defs]) => defs), ROA.flatten);
                    const ops = pipe(values, ROA.map(([, ops]) => ops), ROA.flatten);
                    return pipe(
                        defs,
                        updateScopeSymbols(scope),
                        E.mapLeft(flow(makeParseError(node), ROA.of)),
                        E.map(scope => {
                            const varDefs = pipe(defs, ROA.filter(def => !(def instanceof ConstantSymbolDef)));
                            return [scope, varDefs, ops] as const;
                        })
                    );
                }),
            );
        };
}

const parseVariableStatement =
    (node: tsm.VariableStatement): ParseStatementState =>
        context => {

            const factory = (element: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) =>
                new LocalVariableSymbolDef(element, symbol, index + context.locals.length);

            return pipe(
                node,
                reduceVariableStatement(context.scope)(factory),
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
