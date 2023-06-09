import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';

import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import { flow, identity, pipe } from "fp-ts/function";
import { Operation, pushInt, pushString, updateLocation } from "../types/Operation";
import { CompileError, makeParseError, ParseError, single } from "../utils";
import { parseExpression } from "./expressionProcessor";
import { CompileTimeObject, Scope, updateScope } from "../types/CompileTimeObject";
import { mapLeft } from "fp-ts/lib/EitherT";

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}

// update scope + generate store operations for variable bindings
export function processParsedVariables(
    variables: readonly ParsedVariable[],
    scope: Scope,
    ctoFactory: (node: tsm.Identifier, symbol: tsm.Symbol, index: number) => CompileTimeObject
): { readonly storeOps: readonly Operation[]; readonly scope: Scope; variables: readonly VariableBinding[]} {
    // create CTOs for all the ParsedConstants and add them to the scope
    scope = pipe(
        variables,
        ROA.filterMap(O.fromPredicate(isParsedConstant)),
        ROA.map(v => <CompileTimeObject>{ node: v.node, symbol: v.symbol, loadOps: [v.constant] }),
        updateScope(scope)
    )

    // map all the variable bindings to CTOs via cto factory. 
    // attach binding index to the CTO for use in generating pick operations
    const varCTOs = pipe(
        variables,
        ROA.filterMap(O.fromPredicate(isVariableBinding)),
        ROA.mapWithIndex((index, variable) => ({ cto: ctoFactory(variable.node, variable.symbol, index), variable })),
    )

    // add all the variable CTOs to the scope
    scope = pipe(
        varCTOs,
        ROA.map(({ cto }) => cto),
        updateScope(scope)
    )

    // create the pick operations for the variable CTOs
    const storeOps = pipe(
        varCTOs,
        ROA.matchRight(
            () => ROA.empty,
            (init, last) => {
                return pipe(
                    init,
                    ROA.map(item => pipe(
                        makePickOps(item),
                        ROA.prepend<Operation>({ kind: "duplicate", location: item.cto.node })
                    )),
                    ROA.flatten<Operation>,
                    ROA.concat(pipe(
                        makePickOps(last),
                        updateLocation(last.cto.node)
                    ))
                )
            }
        )
    )

    return { storeOps, scope, variables: pipe(varCTOs, ROA.map(({ variable } ) => variable)) };

    // map the index array to pickitem operations and concat with the store operations
    function makePickOps(
        { cto, variable }: { cto: CompileTimeObject; variable: VariableBinding; }
    ): readonly Operation[] {
        if (!cto.storeOps) throw new CompileError('unexpected missing storeOps', cto.node);
        return pipe(
            variable.index,
            ROA.chain(index => {
                const indexOp = typeof index === 'number' ? pushInt(index) : pushString(index);
                return ROA.fromArray<Operation>([indexOp, { kind: 'pickitem' }]);
            }),
            ROA.concat(cto.storeOps)
        )
    }
}

export interface ParsedConstant {
    readonly node: tsm.Identifier;
    readonly symbol: tsm.Symbol;
    readonly constant: Operation;
}

export type ParsedVariable = ParsedConstant | VariableBinding;

export function isParsedConstant(v: ParsedVariable): v is ParsedConstant {
    return 'constant' in v;
}

export function isVariableBinding(v: ParsedVariable): v is VariableBinding {
    return 'index' in v;
}

// parseVariableBinding broken out for test purposes
export function parseVariableBinding(
    node: tsm.VariableDeclaration,
    kind: tsm.VariableDeclarationKind,
    initOp: O.Option<Operation>
): E.Either<readonly ParseError[], readonly ParsedVariable[]> {
    return pipe(
        node.getNameNode(),
        readNestedVariableBinding,
        E.map(flattenNestedVaribleBinding),
        E.map(variables => {
            return pipe(
                initOp,
                O.chain(O.fromPredicate(isPushOp)),
                O.chain(O.fromPredicate(() => kind == tsm.VariableDeclarationKind.Const)),
                O.chain(initOp => {
                    return variables.length === 1
                        ? pipe(
                            { node: variables[0].node, symbol: variables[0].symbol, constant: initOp } as ParsedVariable,
                            ROA.of,
                            O.some)
                        : O.none
                }),
                O.getOrElse(() => variables as readonly ParsedVariable[])
            )
        })
    )
}

// parse the variable declaration, returning an array of parsed constants and variables 
export function parseVariableDeclaration(scope: Scope, kind: tsm.VariableDeclarationKind) {
    return (node: tsm.VariableDeclaration): E.Either<readonly ParseError[], readonly ParsedVariable[]> => {
        return pipe(
            node.getInitializer(),
            O.fromNullable,
            O.map(parseExpression(scope)),
            O.match(() => E.of(O.none), E.map(O.some)),
            E.map(O.chain(single)),
            E.mapLeft(ROA.of),
            E.chain(initOp => parseVariableBinding(node, kind, initOp))
        )
    }
}

function readIdentifier(node: tsm.Identifier): E.Either<readonly ParseError[], IdentifierBinding> {
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => <IdentifierBinding>{ node, symbol }),
        E.mapLeft(ROA.of)
    )
}

function readArrayBinding(elements: readonly (tsm.Expression | tsm.BindingElement)[]): E.Either<readonly ParseError[], NestedVariableBinding> {
    const { left, right: vars } = pipe(
        elements,
        ROA.mapWithIndex((index, element) => [element, index] as const),
        ROA.filter(([element]) => !tsm.Node.isOmittedExpression(element)),
        ROA.map(([element, index]) => pipe(
            element,
            readNestedVariableBinding,
            E.map($var => [$var, index] as const)
        )),
        ROA.separate
    )
    const errors = pipe(left, ROA.flatten);
    if (errors.length > 0) return E.left(errors);
    return E.of(vars);
}

function readObjectBindingPattern(node: tsm.ObjectBindingPattern): E.Either<readonly ParseError[], NestedVariableBinding> {
    const { left, right: vars } = pipe(
        node.getElements(),
        ROA.map(element => {
            return pipe(
                E.Do,
                E.bind('$var', () => pipe(element.getNameNode(), readNestedVariableBinding)),
                E.bind('index', () => pipe(
                    element.getPropertyNameNode(),
                    O.fromNullable,
                    O.chain(TS.getSymbol),
                    O.alt(() => pipe(element.getNameNode(), TS.getSymbol)),
                    O.map(symbol => symbol.getName()),
                    E.fromOption(() => ROA.of(makeParseError(element)(`could not find property symbol for object binding element`)))
                )),
                E.map(({ $var, index }) => {
                    return [$var, index] as const;
                })
            )
        }),
        ROA.separate
    )
    const errors = pipe(left, ROA.flatten);
    if (errors.length > 0) return E.left(errors);
    return E.of(vars);
}

function readObjectLiteralExpression(node: tsm.ObjectLiteralExpression): E.Either<readonly ParseError[], NestedVariableBinding> {
    const { left, right: vars } = pipe(
        node.getProperties(),
        ROA.map(readObjectLiteralProperty),
        ROA.separate
    );

    const errors = pipe(left, ROA.flatten);
    if (errors.length > 0) return E.left(errors);
    return E.of(vars);

    function readObjectLiteralProperty(prop: tsm.ObjectLiteralElementLike) {
        if (tsm.Node.isShorthandPropertyAssignment(prop)) {
            // for shorthand property assignments, the index is the same as the property name
            return pipe(
                prop.getNameNode(),
                readIdentifier,
                E.map($var => [$var, $var.symbol.getName()] as const)
            );
        }
        if (tsm.Node.isPropertyAssignment(prop)) {
            // for property assignments, read the initializer as a bound variable 
            // and read the name node as the index
            return pipe(
                prop.getInitializer(),
                E.fromNullable(makeParseError(prop)(`expected initializer for property assignment`)),
                E.mapLeft(ROA.of),
                E.chain(readNestedVariableBinding),
                E.bindTo('$var'),
                E.bind('index', () => {
                    return pipe(
                        prop.getNameNode().asKind(tsm.SyntaxKind.Identifier),
                        E.fromNullable(makeParseError(prop.getNameNode())(`expected identifier for property name node`)),
                        E.chain(TS.parseSymbol),
                        E.map(symbol => symbol.getName()),
                        E.mapLeft(ROA.of)
                    );
                }),
                E.map(({ $var, index }) => [$var, index] as const)
            );
        }
        return pipe(
            makeParseError(prop)(`unsupoorted property kind ${prop.getKindName()}`),
            ROA.of,
            E.left
        );
    }
}

export interface IdentifierBinding {
    readonly node: tsm.Identifier;
    readonly symbol: tsm.Symbol;
}

export type NestedVariableBindings = readonly (readonly [NestedVariableBinding, number | string])[];
export type NestedVariableBinding = IdentifierBinding | NestedVariableBindings;

export function isIdentifierBinding(value: NestedVariableBinding): value is IdentifierBinding {
    return !Array.isArray(value);
}

// 
export function readNestedVariableBinding(
    node: tsm.BindingElement | tsm.BindingName | tsm.Expression
): E.Either<readonly ParseError[], NestedVariableBinding> {
    if (tsm.Node.isIdentifier(node)) return readIdentifier(node);
    if (tsm.Node.isBindingElement(node)) return readNestedVariableBinding(node.getNameNode());
    if (tsm.Node.isArrayBindingPattern(node)) return pipe(node.getElements(), readArrayBinding);
    if (tsm.Node.isArrayLiteralExpression(node)) return pipe(node.getElements(), readArrayBinding);
    if (tsm.Node.isObjectBindingPattern(node)) return readObjectBindingPattern(node);
    if (tsm.Node.isObjectLiteralExpression(node)) return readObjectLiteralExpression(node);
    return pipe(makeParseError(node)(`readBoundVariables ${node.getKindName()} unsupported`), ROA.of, E.left);
}

export type VariableBinding = {
    readonly node: tsm.Identifier;
    readonly symbol: tsm.Symbol;
    readonly index: readonly (number | string)[]
}

export function flattenNestedVaribleBinding($var: NestedVariableBinding, index: readonly (number | string)[] = []): readonly VariableBinding[] {
    if (isIdentifierBinding($var)) return [{ node: $var.node, symbol: $var.symbol, index }];

    return pipe(
        $var,
        ROA.chain(([$var, i]) => flattenNestedVaribleBinding($var, pipe(index, ROA.append(i))))
    )
}