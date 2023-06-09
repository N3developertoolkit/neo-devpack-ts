import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';

import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import { pipe } from "fp-ts/function";
import { Operation, pushInt, pushString, updateLocation } from "../types/Operation";
import { CompileError, makeParseError, ParseError, single } from "../utils";
import { parseExpression } from "./expressionProcessor";
import { CompileTimeObject, Scope, updateScope } from "../types/CompileTimeObject";

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}

type CompileTimeObjectWithIndex = {
    cto: CompileTimeObject;
    name: string;
    index: readonly (string | number)[];
};

export function generateStoreOps(variables: readonly CompileTimeObjectWithIndex[]): E.Either<ParseError, readonly Operation[]> {
    // generate store operations for each indexed CTO
    // the store ops are generated from each CTO's index + store ops, with each variable except the last
    // getting a duplicate copy of the initialization value (generated elsewhere)
    return pipe(
        variables,
        ROA.matchRight(
            () => E.of(ROA.empty),
            (init, last) => {
                return pipe(
                    init,
                    ROA.map(item => pipe(
                        makeStoreOps(item),
                        E.map(ROA.append<Operation>({ kind: "duplicate", location: item.cto.node })),
                    )),
                    ROA.append(pipe(
                        makeStoreOps(last),
                        E.map(updateLocation(last.cto.node))
                    )),
                    ROA.sequence(E.Applicative),
                    E.map(ROA.flatten)
                )
            }
        )
    )

    // map the index array to pickitem operations and concat with the CTO's store operations
    function makeStoreOps({ cto, name, index }: CompileTimeObjectWithIndex): E.Either<ParseError, readonly Operation[]> {
        if (!cto.storeOps) {
            return E.left(makeParseError(cto.node)(`variable ${name} does not have store ops`));
        }

        return pipe(
            index,
            ROA.chain(index => {
                const indexStoreOp = typeof index === 'number' ? pushInt(index) : pushString(index);
                return ROA.fromArray<Operation>([indexStoreOp, { kind: 'pickitem' }]);
            }),
            ROA.concat(cto.storeOps),
            E.of
        )
    }
}

// update the scope with the declared variables and return an array of all the generated CTOs with their index info
export function updateDeclarationScope(
    variables: readonly ParsedVariable[],
    scope: Scope,
    ctoFactory: (node: tsm.Identifier, symbol: tsm.Symbol, index: number) => CompileTimeObject
): { scope: Scope; variables: readonly CompileTimeObjectWithIndex[]; } {
    // create CTOs for all the ParsedConstants and add them to the scope
    scope = pipe(
        variables,
        ROA.filterMap(O.fromPredicate(isParsedConstant)),
        ROA.map(v => <CompileTimeObject>{ node: v.node, symbol: v.symbol, loadOps: [v.constant] }),
        updateScope(scope)
    )

    // map all the variable bindings to CTOs via cto factory. 
    // attach binding index to the CTO for later use in generating pick operations
    const $variables = pipe(
        variables,
        ROA.filterMap(O.fromPredicate(isVariableBinding)),
        ROA.mapWithIndex((index, variable) => ({
            cto: ctoFactory(variable.node, variable.symbol, index),
            name: variable.symbol.getName(),
            index: variable.index
        })),
    )

    // add all the variable CTOs to the scope
    scope = pipe(
        $variables,
        ROA.map(({ cto }) => cto),
        updateScope(scope)
    )

    return { scope, variables: $variables }
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

function readArrayBindingPattern(node: tsm.ArrayBindingPattern): E.Either<readonly ParseError[], NestedVariableBinding> {
    const { left, right: vars } = pipe(
        node.getElements(),
        ROA.mapWithIndex((index, element) => [element, index] as const),
        ROA.filter(([element]) => tsm.Node.isBindingElement(element)),
        ROA.map(([element, index]) => pipe(
            (element as tsm.BindingElement).getNameNode(),
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


// Originally, I thought I could use basically the same code for handling both var decl bindings
// and array/object literal assignment. However, literal assignment supports element and property
// assignment, so the binding code is not sufficient. 

// function readObjectLiteralExpression(node: tsm.ObjectLiteralExpression): E.Either<readonly ParseError[], NestedVariableBinding> {
//     const { left, right: vars } = pipe(
//         node.getProperties(),
//         ROA.map(readObjectLiteralProperty),
//         ROA.separate
//     );

//     const errors = pipe(left, ROA.flatten);
//     if (errors.length > 0) return E.left(errors);
//     return E.of(vars);

//     function readObjectLiteralProperty(prop: tsm.ObjectLiteralElementLike) {
//         if (tsm.Node.isShorthandPropertyAssignment(prop)) {
//             // for shorthand property assignments, the index is the same as the property name
//             return pipe(
//                 prop.getNameNode(),
//                 readIdentifier,
//                 E.map($var => [$var, $var.symbol.getName()] as const)
//             );
//         }
//         if (tsm.Node.isPropertyAssignment(prop)) {
//             // for property assignments, read the initializer as a bound variable 
//             // and read the name node as the index
//             return pipe(
//                 prop.getInitializer(),
//                 E.fromNullable(makeParseError(prop)(`expected initializer for property assignment`)),
//                 E.mapLeft(ROA.of),
//                 E.chain(readNestedVariableBinding),
//                 E.bindTo('$var'),
//                 E.bind('index', () => {
//                     return pipe(
//                         prop.getNameNode().asKind(tsm.SyntaxKind.Identifier),
//                         E.fromNullable(makeParseError(prop.getNameNode())(`expected identifier for property name node`)),
//                         E.chain(TS.parseSymbol),
//                         E.map(symbol => symbol.getName()),
//                         E.mapLeft(ROA.of)
//                     );
//                 }),
//                 E.map(({ $var, index }) => [$var, index] as const)
//             );
//         }
//         return pipe(
//             makeParseError(prop)(`unsupoorted property kind ${prop.getKindName()}`),
//             ROA.of,
//             E.left
//         );
//     }
// }

export interface IdentifierBinding {
    readonly node: tsm.Identifier;
    readonly symbol: tsm.Symbol;
}

export type NestedVariableBindings = readonly (readonly [NestedVariableBinding, number | string])[];
export type NestedVariableBinding = IdentifierBinding | NestedVariableBindings;

export function isIdentifierBinding(value: NestedVariableBinding): value is IdentifierBinding {
    return !Array.isArray(value);
}

export function readNestedVariableBinding(node: tsm.BindingName): E.Either<readonly ParseError[], NestedVariableBinding> {
    if (tsm.Node.isIdentifier(node)) return readIdentifier(node);
    else if (tsm.Node.isArrayBindingPattern(node)) return readArrayBindingPattern(node);
    else return readObjectBindingPattern(node);
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