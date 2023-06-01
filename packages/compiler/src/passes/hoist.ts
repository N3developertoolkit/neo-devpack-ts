import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import { pipe } from "fp-ts/function";
import { Operation, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, CallInvokeResolver, GetValueFunc } from "../types/CompileTimeObject";
import { makeParseError, ParseError } from "../utils";

function $parseArguments(args: readonly GetValueFunc[]): E.Either<ParseError, readonly Operation[]> {
    return pipe(
        args,
        ROA.reverse,
        ROA.map(arg => pipe(arg(), E.map(ctv => ctv.loadOps))),
        ROA.sequence(E.Applicative),
        E.map(ROA.flatten)
    );
}

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
                    $parseArguments,
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
                    $parseArguments,
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

    function makeDecls(elements: readonly tsm.BindingElement[]) {
        return pipe(
            elements,
            ROA.map(e => {
                const identifier = e.getNameNode().asKind(tsm.SyntaxKind.Identifier);
                return identifier ? E.of(identifier) : E.left(makeParseError(e)("invalid binding element"));
            }),
            ROA.map(E.map(node => <VariableDeclaration>{ node, kind })),
            ROA.separate
        );
    }

    for (const decl of node.getDeclarations()) {
        const name = decl.getNameNode();

        if (tsm.Node.isIdentifier(name)) {
            declarations.push({ node: name, kind });
        } else if (tsm.Node.isArrayBindingPattern(name)) {
            const { left, right } = pipe(
                name.getElements(),
                ROA.filter(tsm.Node.isBindingElement),
                makeDecls
            );
            errors.push(...left);
            declarations.push(...right);
        } else if (tsm.Node.isObjectBindingPattern(name)) {
            const { left, right } = pipe(name.getElements(), makeDecls);
            errors.push(...left);
            declarations.push(...right);
        } else {
            errors.push(makeParseError(node)(`invalid variable declaration kind ${(name as tsm.BindingName).getKindName()}`));
        }
    }

    return errors.length === 0 ? E.of(declarations) : E.left(errors);
}

// eventually, this function needs a few more params:
//  * parent scope
//  * seed CTOs (primarily to pass in parameter CTOs)
//  * variable factory
function hoist2(node: tsm.Node) {
    const ctos = new Array<CompileTimeObject>();
    const errors = new Array<ParseError>();
    const vars = new Array<VariableDeclaration>();



    node.forEachChild(child => {
        // TODO: interfaces, types, enums
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
    });
}
