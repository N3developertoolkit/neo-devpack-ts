import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import { updateScopeSymbols } from "../scope";
import { Scope, SymbolDef } from "../types/ScopeType";
import { Operation, pushInt, pushString, updateLocation } from "../types/Operation";
import { E_fromSeparated, ParseError, makeParseError, single } from "../utils";
import { parseSymbol } from "./parseSymbol";
import { parseExpression as $parseExpression } from "./expressionProcessor";
import { ConstantSymbolDef } from "./sourceSymbolDefs";

type VariableSymbolDef = SymbolDef & { readonly decl: tsm.Node; readonly storeOp: Operation; };
type VariableFactory = (element: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) => VariableSymbolDef;

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}

function handleIdentifierBinding(
    node: tsm.Identifier,
    declKind: tsm.VariableDeclarationKind,
    factory: VariableFactory,
    initOps: readonly Operation[]
): E.Either<ParseError, [readonly SymbolDef[], readonly Operation[]]> {
    return pipe(
        node,
        parseSymbol,
        E.chain(symbol => pipe(
            // if declKind is const and initOps is a single push operation
            // create a ConstantSymbolDef for the constant value.
            // Otherwise, create a variable using the factory
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
            v => E.of(v)
        ))
    );
}

function handleArrayBindingPattern(
    node: tsm.ArrayBindingPattern,
    factory: VariableFactory,
    initOps: readonly Operation[]
): E.Either<ParseError, [readonly SymbolDef[], readonly Operation[]]> {
    return pipe(
        node.getElements(),
        // associated index with each element
        ROA.mapWithIndex((index, element) => [element, index] as const),
        // filter out the omitted elements
        ROA.filter(([element]) => tsm.Node.isBindingElement(element)),
        ROA.map(([element, index]) => [element as tsm.BindingElement, index] as const),
        // create a VariableSymbolDef via the factory for each element
        ROA.map(([element, index]) => pipe(
            element,
            parseSymbol,
            E.map(symbol => factory(element, symbol, index)),
            E.map(def => [def, index] as const)
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
                        // duplicate the init result, pick the specified index
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
                );
            }
            else {
                // if there are no elements, drop the init result (if any)
                const ops = ROA.isNonEmpty(initOps) ? ROA.of({ kind: "drop" } as Operation) : ROA.empty;
                return E.of(ops);
            }
        }),
        E.map(({ elements, storeOps }) => {
            const ops = ROA.concat(storeOps)(initOps);
            const defs = pipe(elements, ROA.map(([def]) => def));
            return [defs, ops];
        })
    );
}

function handleObjectBindingPattern(
    node: tsm.ObjectBindingPattern,
    factory: VariableFactory,
    initOps: readonly Operation[]
): E.Either<ParseError, [readonly SymbolDef[], readonly Operation[]]> {
    return pipe(
        node.getElements(),
        // create a VariableSymbolDef via the factory for each element
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
                );
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
        switch (propNode?.getKind()) {
            case tsm.SyntaxKind.Identifier:
                return O.of(propNode.getText());
            default:
                return O.none;
        }
    }
}

const handleVariableDeclaration =
    (node: tsm.BindingName, declKind: tsm.VariableDeclarationKind, factory: VariableFactory) =>
        (initOps: readonly Operation[]): E.Either<ParseError, [readonly SymbolDef[], readonly Operation[]]> => {
            switch (node.getKind()) {
                case tsm.SyntaxKind.Identifier:
                    return handleIdentifierBinding(node as tsm.Identifier, declKind, factory, initOps);
                case tsm.SyntaxKind.ArrayBindingPattern:
                    return handleArrayBindingPattern(node as tsm.ArrayBindingPattern, factory, initOps);
                case tsm.SyntaxKind.ObjectBindingPattern:
                    return handleObjectBindingPattern(node as tsm.ObjectBindingPattern, factory, initOps);
                default:
                    return E.left(makeParseError(node)(`Unexpected binding name ${node.getKindName()}`));
            }
        };

// helper method for parsing variable statements. This is used for parsing both top-level static variables
// in sourceFileProcessor as well as for local variables in functionDeclarationProcessor

export const handleVariableStatement =
    (scope: Scope) =>
        (factory: (element: tsm.Identifier | tsm.BindingElement, symbol: tsm.Symbol, index: number) => VariableSymbolDef) =>
            (node: tsm.VariableStatement): E.Either<readonly ParseError[], readonly [Scope, readonly SymbolDef[], readonly Operation[]]> => {
                return pipe(
                    node.getDeclarations(),
                    ROA.map(decl => pipe(
                        decl.getInitializer(),
                        O.fromNullable,
                        O.match(
                            () => node.getDeclarationKind() === tsm.VariableDeclarationKind.Const
                                ? E.left(makeParseError(node)(`Constant variable ${decl.getName()} must have an initializer`))
                                : E.of(ROA.empty),
                            init => pipe(
                                init,
                                $parseExpression(scope),
                                E.map(updateLocation(init))
                            )),
                        E.chain(handleVariableDeclaration(decl.getNameNode(), node.getDeclarationKind(), factory))
                    )),
                    ROA.separate,
                    E_fromSeparated,
                    E.chain(values => {
                        const defs = pipe(values, ROA.map(([defs]) => defs), ROA.flatten);
                        const ops = pipe(values, ROA.map(([, ops]) => ops), ROA.flatten);
                        return pipe(
                            defs,
                            // add all the symbol definitions to the scope
                            updateScopeSymbols(scope),
                            E.mapLeft(flow(makeParseError(node), ROA.of)),
                            E.map(scope => pipe(
                                defs,
                                // filter out all the constants from the array of symbol definitions
                                // that get returned to the caller
                                ROA.filter(def => !(def instanceof ConstantSymbolDef)),
                                varDefs => [scope, varDefs, ops] as const
                            ))
                        );
                    })
                );
            };

