import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';

import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import { flow, pipe } from "fp-ts/function";
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

export interface ParsedVariable {
    readonly node: tsm.Identifier;
    readonly symbol: tsm.Symbol;
    readonly constant?: Operation;
    readonly index?: number | string;
}

function parseIdentifierBinding(
    node: tsm.Identifier,
    kind: tsm.VariableDeclarationKind,
    initOps: readonly Operation[]
): E.Either<readonly ParseError[], readonly ParsedVariable[]> {
    return pipe(
        initOps,
        O.fromPredicate(() => kind === tsm.VariableDeclarationKind.Const),
        O.chain(flow(
            ROA.filter(op => op.kind != 'noop'),
            single,
            O.chain(O.fromPredicate(isPushOp))
        )),
        E.of,
        E.bindTo('constant'),
        E.bind('symbol', () => TS.parseSymbol(node)),
        E.map(({ constant, symbol }) => pipe(
            constant,
            O.match(
                () => <ParsedVariable>{ node, symbol },
                constant => <ParsedVariable>{ node, symbol, constant }
            )
        )),
        E.map(ROA.of),
        E.mapLeft(ROA.of)
    );
}

function parseArrayBinding(node: tsm.ArrayBindingPattern): E.Either<readonly ParseError[], readonly ParsedVariable[]> {
    const { left, right } = pipe(
        node.getElements(),
        // associated index with each element
        ROA.mapWithIndex((index, element) => [element, index] as const),
        // filter out the omitted elements
        ROA.filter(([element]) => tsm.Node.isBindingElement(element)),
        ROA.map(([element, index]) => {
            return pipe(
                (element as tsm.BindingElement).getNameNode().asKind(tsm.SyntaxKind.Identifier),
                E.fromNullable(makeParseError(element)(`could not find identifier for array binding element`)),
                E.bindTo('node'),
                E.bind('symbol', ({ node }) => TS.parseSymbol(node)),
                E.map(({ node, symbol }) => <ParsedVariable>{ node, symbol, index })
            );
        }),
        ROA.separate
    );

    return left.length > 0 ? E.left(left) : E.right(right);
}

function parseObjectBinding(node: tsm.ObjectBindingPattern): E.Either<readonly ParseError[], readonly ParsedVariable[]> {
    const { left, right } = pipe(
        node.getElements(),
        ROA.map(element => {
            return pipe(
                E.Do,
                E.bind('node', () => pipe(
                    element.getNameNode().asKind(tsm.SyntaxKind.Identifier),
                    E.fromNullable(makeParseError(element)(`could not find identifier for object binding element`))
                )),
                E.bind('symbol', ({ node }) => pipe(node, TS.parseSymbol)),
                E.bind('index', ({ node }) => pipe(
                    element.getPropertyNameNode(),
                    O.fromNullable,
                    O.chain(TS.getSymbol),
                    O.alt(() => pipe(node.getSymbol(), O.fromNullable)),
                    O.map(symbol => symbol.getName()),
                    E.fromOption(() => makeParseError(element)(`could not find property symbol for object binding element`))
                )),
                E.map(value => value as ParsedVariable)
            );
        }),
        ROA.separate
    );
    return left.length > 0 ? E.left(left) : E.right(right);
}

export function parseVariableBinding(
    node: tsm.VariableDeclaration,
    kind: tsm.VariableDeclarationKind,
    initOps: readonly Operation[]
): E.Either<readonly ParseError[], readonly ParsedVariable[]> {
    const name = node.getNameNode();
    switch (name.getKind()) {
        case tsm.SyntaxKind.Identifier:
            return parseIdentifierBinding(name as tsm.Identifier, kind, initOps);
        case tsm.SyntaxKind.ArrayBindingPattern:
            return parseArrayBinding(name as tsm.ArrayBindingPattern);
        case tsm.SyntaxKind.ObjectBindingPattern:
            return parseObjectBinding(name as tsm.ObjectBindingPattern);
        default: {
            const error = makeParseError(name)(`unsupported variable declaration name ${name.getKindName()}`);
            return E.left(ROA.of(error));
        }
    }
}

interface ParseVarDeclResults {
    readonly initOps: readonly Operation[]; 
    readonly variables: readonly ParsedVariable[];
}

export function parseVariableDeclaration(scope: Scope, kind: tsm.VariableDeclarationKind) {
    return (node: tsm.VariableDeclaration): E.Either<readonly ParseError[], ParseVarDeclResults> => {
        return pipe(
            node.getInitializer(),
            O.fromNullable,
            O.match(
                () => E.of(ROA.empty),
                init => pipe(
                    init,
                    parseExpression(scope)
                )
            ),
            E.bindTo('initOps'),
            E.mapLeft(ROA.of),
            E.bind('variables', ({ initOps }) => parseVariableBinding(node, kind, initOps)),
        );
    }
}

export function processVarDeclResults(scope: Scope, makeCTO: (index: number, v: ParsedVariable) => CompileTimeObject) {
    return ({initOps, variables: resultVariables}: ParseVarDeclResults) => {
        // create CTOs for all the constant parsed variables and add them to the scope
        scope = pipe(
            resultVariables,
            ROA.filter(v => !!v.constant),
            ROA.map(v => <CompileTimeObject>{ node: v.node, symbol: v.symbol, loadOps: [v.constant] }),
            updateScope(scope)
        );

        // create an array of all the non-constant parsed variables
        const variables = pipe(resultVariables, ROA.filter(v => !v.constant));

        if (ROA.isNonEmpty(variables)) {
            // create CTOs for all the non-constant variables
            const varCTOs = pipe(
                variables,
                RNEA.mapWithIndex((index, v) => [makeCTO(index, v), v.index] as const)
            );
    
            // add the variable CTOs to the scope
            scope = pipe(varCTOs, ROA.map(([cto]) => cto), updateScope(scope))
    
            // create the pick operations for the variable CTOs
            const pickOps = pipe(
                varCTOs,
                RNEA.matchRight(
                    (init, [lastCTO, lastIndex]) => {
                        return pipe(
                            init,
                            ROA.map(([cto, index]) => pipe(
                                makePickOps(cto, index),
                                ROA.prepend<Operation>({ kind: "duplicate", location: cto.node })
                            )),
                            ROA.flatten<Operation>, ROA.concat(pipe(
                                makePickOps(lastCTO, lastIndex),
                                updateLocation(lastCTO.node)
                            ))
                        );
                    }
                )
            );

            // combine the initialization operations with the pick operations
            const ops = ROA.concat(pickOps)(initOps);
   
            return { scope, variables, ops };
        } else {    
            return { scope, variables: [], ops: [] };
        } 

        function makePickOps(cto: CompileTimeObject, index: string | number | undefined): readonly Operation[] {
            if (!cto.storeOps)
                throw new CompileError('unexpected missing storeOps', cto.node);
            if (!index)
                return cto.storeOps;
            const indexOp = typeof index === 'number' ? pushInt(index) : pushString(index);
            return [indexOp, { kind: 'pickitem' }, ...cto.storeOps];
        }
    }
}
