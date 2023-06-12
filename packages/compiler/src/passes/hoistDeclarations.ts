import * as tsm from "ts-morph";
import * as ROA from 'fp-ts/ReadonlyArray';
import * as TS from '../TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option';
import { pipe } from "fp-ts/function";
import { Operation, pushInt, pushString } from "../types/Operation";
import { CompileTimeObject, CallInvokeResolver, PropertyResolver, CompileTimeType, Scope, createScope, parseArguments, createEmptyScope } from "../types/CompileTimeObject";
import { makeParseError, makeReadOnlyMap, ParseError } from "../utils";

function hoistEventFunctionDecl(node: tsm.FunctionDeclaration) {
    const paramCount = node.getParameters().length;
    return (eventName: string): E.Either<ParseError, CompileTimeObject> => {
        return pipe(
            node,
            TS.parseSymbol,
            E.map(symbol => {
                const call: CallInvokeResolver = (node) => (_$this, args) => {
                    return pipe(
                        args,
                        parseArguments(paramCount),
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
}

function getEventName(node: tsm.FunctionDeclaration): O.Option<string> {

    return pipe(
        node,
        TS.getTag("event"),
        O.chain(tag => O.fromNullable(tag.getCommentText())),
        O.alt(() => pipe(
            node,
            TS.getSymbol,
            O.map(symbol => symbol.getName())
        ))
    )
}



export function hoistFunctionDecl(node: tsm.FunctionDeclaration): E.Either<ParseError, CompileTimeObject> {
    if (node.hasDeclareKeyword()) {
        return pipe(
            node,
            getEventName,
            E.fromOption(() => makeParseError(node)("only @event declare functions supported")),
            E.chain(hoistEventFunctionDecl(node))
        )
    }

    const paramCount = node.getParameters().length;
    return pipe(
        node,
        TS.parseSymbol,
        E.map(symbol => {
            const call: CallInvokeResolver = (node) => ($this, args) => {
                return pipe(
                    args,
                    parseArguments(paramCount),
                    E.map(ROA.append<Operation>({ kind: 'call', method: symbol })),
                    E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                );
            };

            return <CompileTimeObject>{ node, symbol, loadOps: [], call };
        })
    );
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

// export function parseEnumDecl(decl: tsm.EnumDeclaration): E.Either<ParseError, CompileTimeObject> {
//     return pipe(
//         decl.getMembers(),
//         ROA.map(member => pipe(
//             E.Do,
//             E.bind('op', () => pipe(member, getValue, E.mapLeft(e => makeParseError(member)(e)))),
//             E.bind('symbol', () => pipe(member, TS.parseSymbol)),
//             E.map(({ op, symbol }) => <CompileTimeObject>{ node: member, symbol, loadOps: [op] })
//         )),
//         ROA.sequence(E.Applicative),
//         E.bindTo('props'),
//         E.bind('symbol', () => pipe(decl, TS.parseSymbol)),
//         E.map(({ props, symbol }) => {
//             return <CompileTimeObject>{ node: decl, symbol, loadOps: [], properties: makePropResolvers(props) };
//         })
//     );

//     function getValue(member: tsm.EnumMember): E.Either<string, Operation> {
//         const value = member.getValue();
//         if (value === undefined)
//             return E.left(`${decl.getName()}.${member.getName()} undefined value`);
//         if (typeof value === 'number') {
//             return Number.isInteger(value)
//                 ? E.of(pushInt(value))
//                 : E.left(`${decl.getName()}.${member.getName()} invalid non-integer numeric literal ${value}`);
//         }
//         return E.of(pushString(value));
//     }
// }


export function hoistDeclarations(
    parentScope: Scope,
    seedCTOs?: readonly CompileTimeObject[]
) {
    return (node: tsm.Node): E.Either<readonly ParseError[], Scope> => {

        const ctos = new Array<CompileTimeObject>();
        const ctts = new Array<CompileTimeType>();
        const errors = new Array<ParseError>();

        node.forEachChild(child => {

            // Technically, JS hoists all variables. However, TS does not allow use of
            // a variable before it is declared. So variables are skipped during hoisting
            // and processed as they are encountered on the next pass

            if (tsm.Node.isFunctionDeclaration(child)) {
                pipe(child, hoistFunctionDecl, E.match(e => errors.push(e), o => ctos.push(o)));
            }
            if (tsm.Node.isInterfaceDeclaration(child)) {
                pipe(child, hoistInterfaceDecl, E.match(e => errors.push(e), t => ctts.push(t)));
            }
            if (tsm.Node.isTypeAliasDeclaration(child)) {
                const type = child.getType();
                if (!type.isTuple()) {
                    errors.push(makeParseError(child)(`type alias type ${type.getText()} not supported`));
                }
            }
            if (tsm.Node.isEnumDeclaration(child)) {
                errors.push(makeParseError(child)("enums not implemented"));
            }
            if (tsm.Node.isClassDeclaration(child)) {
                errors.push(makeParseError(child)("class declarations not supported"));
            }
        });

        return errors.length > 0
            ? E.left(errors)
            : E.of(createScope(parentScope)(ROA.concat(seedCTOs ?? [])(ctos), ctts))
    }
}
