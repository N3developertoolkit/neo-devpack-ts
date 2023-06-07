import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as ROA from 'fp-ts/ReadonlyArray'
import * as TS from "../TS";

import { GlobalScopeContext } from "./common";
import { CallInvokeResolver, CompileTimeObject, parseArguments } from "../types/CompileTimeObject";
import { createDiagnostic, makeParseDiagnostic, makeParseError, single } from "../utils";
import { Operation, pushInt } from "../types/Operation";


export function makeFunctions(ctx: GlobalScopeContext) {
    makeSyscallFunctions(ctx);
    makeConcat(ctx);
    makeCallContract(ctx);
}

function makeSyscallFunctions(ctx: GlobalScopeContext) {
    const { left: errors, right: objects } = pipe(
        ctx.decls,
        // find all the function declarations that have the @syscall tag
        ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
        ROA.filter(TS.hasTag("syscall")),
        ROA.map(makeFunction),
        ROA.separate
    );
    errors.forEach(ctx.addError);
    objects.forEach(ctx.addObject);

    function makeFunction(node: tsm.FunctionDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeObject> {
        const paramCount = node.getParameters().length;
        return pipe(
            E.Do,
            E.bind("symbol", () => pipe(node, TS.parseSymbol, E.mapLeft(makeParseDiagnostic))),
            E.bind("serviceName", () => pipe(
                node,
                TS.getTagComment('syscall'),
                E.fromOption(() => createDiagnostic(`Invalid @syscall tag for ${node.getName()}`, { node }),
                ))),
            E.map(({ symbol, serviceName }) => {
                const call: CallInvokeResolver = (node) => ($this, args) => {
                    return pipe(
                        args,
                        parseArguments(paramCount),
                        E.map(ROA.append(<Operation>{ kind: 'syscall', name: serviceName })),
                        E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                    );
                }
                return <CompileTimeObject>{ node, symbol, loadOps: [], call };
            }),
        );
    }
}
function makeConcat(ctx: GlobalScopeContext) {
    pipe(
        ctx.declMap.get("concat") ?? [],
        ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
        single,
        O.bindTo("node"),
        O.bind("symbol", ({ node }) => TS.getSymbol(node)),
        O.map(({ node, symbol }) => {
            const paramCount = node.getParameters().length;
            const call: CallInvokeResolver = (node) => ($this, args) => {
                return pipe(
                    args,
                    parseArguments(paramCount),
                    E.map(ROA.append(<Operation>{ kind: 'concat' })),
                    E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                );
            };
            return <CompileTimeObject>{ node, symbol, loadOps: [], call };
        }),
        O.match(
            () => ctx.addError(createDiagnostic("could not find concat function")),
            ctx.addObject
        )
    );
}

function makeCallContract(ctx: GlobalScopeContext) {
    pipe(
        ctx.declMap.get("callContract") ?? [],
        ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
        single,
        O.bindTo("node"),
        O.bind("symbol", ({ node }) => TS.getSymbol(node)),
        O.map(({ node, symbol }) => {
            const call: CallInvokeResolver = (node) => ($this, args) => {
                const callArgs = args.slice(0, 3);
                const targetArgs = args.slice(3);

                if (callArgs.length !== 3) {
                    return E.left(makeParseError(node)("invalid arg count"));
                }

                return pipe(
                    targetArgs,
                    parseArguments(),
                    E.map(ROA.concat<Operation>([
                        pushInt(targetArgs.length),
                        { kind: 'packarray' },
                    ])),
                    E.bindTo('targetOps'),
                    E.bind('callOps', () => pipe(
                        callArgs,
                        parseArguments(),
                        E.map(ROA.append<Operation>({ kind: "syscall", name: "System.Contract.Call" })),
                    )),
                    E.map(({ targetOps, callOps }) => ROA.concat<Operation>(callOps)(targetOps)),
                    E.map(loadOps => <CompileTimeObject>{ node, symbol, loadOps })
                )
            }
            return <CompileTimeObject>{ node, symbol, loadOps: [], call };
        }),
        O.match(
            () => ctx.addError(createDiagnostic("could not find callContract function")),
            ctx.addObject
        )
    )
}

// keep makeOperationFunctions around in case we want to support this later

// const regexOperationTagComment = /(\S+)\s?(\S+)?/
// function makeOperationFunctions(ctx: GlobalScopeContext) {
//     const { left: errors, right: objects } = pipe(
//         ctx.decls,
//         // find all the function declarations that have the @syscall tag
//         ROA.filterMap(O.fromPredicate(tsm.Node.isFunctionDeclaration)),
//         ROA.filter(TS.hasTag("operation")),
//         ROA.map(makeFunction),
//         ROA.separate
//     );
//     errors.forEach(ctx.addError);
//     objects.forEach(ctx.addObject);

//     function makeFunction(node: tsm.FunctionDeclaration): E.Either<tsm.ts.Diagnostic, CompileTimeObject> {
//         return pipe(
//             E.Do,
//             E.bind("symbol", () => pipe(node, TS.parseSymbol, E.mapLeft(makeParseDiagnostic))),
//             // parse the @operations tags into an array of operations
//             E.bind("operations", () => pipe(
//                 node.getJsDocs(),
//                 ROA.chain(doc => doc.getTags()),
//                 ROA.filter(tag => tag.getTagName() === 'operation'),
//                 ROA.map(tag => tag.getCommentText() ?? ""),
//                 ROA.map(parseOperationTagComment),
//                 ROA.sequence(E.Applicative),
//                 E.mapLeft(msg => createDiagnostic(msg, { node }))
//             )),
//             // TODO: real CTO
//             E.map(({ symbol, operations }) => <CompileTimeObject>{ node, symbol, loadOps: [] }),
//         );
//     }

//     function parseOperationTagComment(comment: string): E.Either<string, Operation> {
//         const matches = comment.match(regexOperationTagComment) ?? [];
//         return matches.length === 3
//             ? pipe(
//                 parseOperation(matches[1], matches[2]),
//                 E.fromNullable(comment)
//             )
//             : E.left(comment);
//     }
// }

