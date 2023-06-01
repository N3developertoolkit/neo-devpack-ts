import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import { pipe } from "fp-ts/function";
import { Operation, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, CallInvokeResolver, GetValueFunc, PropertyResolver, CompileTimeType, Scope, createScope, parseArguments } from "../types/CompileTimeObject";
import { makeParseError, makeReadOnlyMap, ParseError } from "../utils";

export function hoistEventFunctionDecl(node: tsm.FunctionDeclaration): E.Either<ParseError, CompileTimeObject> {
    if (!node.hasDeclareKeyword())
        return E.left(makeParseError(node)('only @event declare functions supported'));

    return pipe(
        node,
        TS.parseSymbol,
        E.bindTo("symbol"),
        E.bind("eventName", ({ symbol }) => pipe(
            node,
            TS.getTag("event"),
            O.map(tag => tag.getCommentText() ?? symbol.getName()),
            E.fromOption(() => makeParseError(node)('event name required'))
        )),
        E.map(({ eventName, symbol }) => {
            const call: CallInvokeResolver = (node) => ($this, args) => {
                return pipe(
                    args,
                    parseArguments,
                    E.map(ROA.concat<Operation>([
                        pushInt(args.length),
                        { kind: 'packarray' },
                        pushString(eventName),
                        { kind: 'syscall', name: "System.Runtime.Notify" }
                    ])),
                    E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                );
            };

            return <CompileTimeObject>{ node, symbol, loadOps: [], call };
        })
    );
}

export function hoistFunctionDecl(node: tsm.FunctionDeclaration): E.Either<ParseError, CompileTimeObject> {
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => {
            const call: CallInvokeResolver = (node) => ($this, args) => {
                return pipe(
                    args,
                    parseArguments,
                    E.map(ROA.append<Operation>({ kind: 'call', method: symbol })),
                    E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                );
            };

            return <CompileTimeObject>{ node, symbol, loadOps: [], call };
        })
    );
}

interface VariableDeclaration {
    readonly node: tsm.Identifier;
    readonly kind: tsm.VariableDeclarationKind;
}

export function hoistVariableStmt(node: tsm.VariableStatement): E.Either<readonly ParseError[], readonly VariableDeclaration[]> {
    // during the hoisting phase, we're not trying to parse the initializer or bind the load or store operations. 
    //  * Initializer will be parsed during the code parsing phase.
    //  * Variable Load/Store operations are context sensitive (static vs local vs closure) so collect just context-insensitive information here.
    //    Final resolution will happen in top level hoist method
    const kind = node.getDeclarationKind();
    const declarations = new Array<VariableDeclaration>();
    const errors = new Array<ParseError>();

    for (const decl of node.getDeclarations()) {
        const name = decl.getNameNode();

        if (tsm.Node.isIdentifier(name)) {
            declarations.push({ node: name, kind });
        } else if (tsm.Node.isArrayBindingPattern(name)) {
            const { left, right } = pipe(
                name.getElements(),
                ROA.filter(tsm.Node.isBindingElement),
                mapBindingElements
            );
            errors.push(...left);
            declarations.push(...right);
        } else if (tsm.Node.isObjectBindingPattern(name)) {
            const { left, right } = pipe(name.getElements(), mapBindingElements);
            errors.push(...left);
            declarations.push(...right);
        } else {
            errors.push(makeParseError(node)(`invalid variable declaration kind ${(name as tsm.BindingName).getKindName()}`));
        }
    }

    return errors.length === 0 ? E.of(declarations) : E.left(errors);

    function mapBindingElements(elements: readonly tsm.BindingElement[]) {
        return pipe(
            elements,
            ROA.map(e => {
                return pipe(
                    e.getNameNode(),
                    name => name.asKind(tsm.SyntaxKind.Identifier),
                    E.fromNullable(makeParseError(e)("invalid binding element"))
                )
            }),
            ROA.map(E.map(node => <VariableDeclaration>{ node, kind })),
            ROA.separate
        );
    }
}

export function hoistInterfaceDecl(node: tsm.InterfaceDeclaration): E.Either<ParseError, CompileTimeType> {
    const type = node.getType();
    return pipe(
        type.getProperties(),
        ROA.map(symbol => {
            return pipe(
                symbol.getValueDeclaration(),
                E.fromNullable(makeParseError(node)(`invalid value declaration for ${symbol.getName()}`)),
                E.chain(decl => pipe(
                    decl,
                    E.fromPredicate(
                        tsm.Node.isPropertySignature, 
                        () => makeParseError(decl)(`only property interface members currently supported`))
                )),
                E.map(node => {
                    const name = symbol.getName();
                    const resolver: PropertyResolver = ($this) => pipe(
                        $this(),
                        E.map(ops => {
                            const loadOps = ROA.concat<Operation>([pushString(name), { kind: 'pickitem' }])(ops);
                            const storeOps = ROA.concat<Operation>([pushString(name), { kind: 'setitem' }])(ops);
                            return <CompileTimeObject>{ node, symbol, loadOps, storeOps };
                        })
                    );
                    return [symbol, resolver] as const;
                })
            );
        }),
        ROA.sequence(E.Applicative),
        E.map(makeReadOnlyMap),
        E.map(properties => <CompileTimeType>{ type, properties })
    )
}

function hoistDeclarations(
    parentScope: Scope, 
    node: tsm.Node, 
    varFactory: (decl: VariableDeclaration) => CompileTimeObject, 
    seedCTOs?: readonly CompileTimeObject[]
): E.Either<readonly ParseError[], Scope>  {

    const ctos = new Array<CompileTimeObject>();
    const errors = new Array<ParseError>();
    const vars = new Array<VariableDeclaration>();

    // TODO: InterfaceDeclarations, TypeAliasDeclarations, EnumDeclarations

    node.forEachChild(child => {
        if (tsm.Node.isFunctionDeclaration(child)) {
            const result = hoistFunctionDecl(child);
            if (E.isLeft(result))
                errors.push(result.left);
            else
                ctos.push(result.right);
        }
        if (tsm.Node.isVariableStatement(child)) {
            const result = hoistVariableStmt(child);
            if (E.isLeft(result))
                errors.push(...result.left);
            else
                vars.push(...result.right);
        }
        if (tsm.Node.isClassDeclaration(child)) {
            errors.push(makeParseError(child)("class declarations not supported"));
        }
    });

    if (errors.length > 0) return E.left(errors);

    const varCTOs = pipe(vars, ROA.map(varFactory));
    const allCTOs = pipe(ctos, ROA.concat(seedCTOs ?? []), ROA.concat(varCTOs));
    return E.of(createScope(parentScope)(allCTOs));
}
