import * as tsm from "ts-morph";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import * as ROR from 'fp-ts/ReadonlyRecord';
import { Ord as StringOrd } from 'fp-ts/string';
import { Operation } from "../types/Operation";
import { CompileTimeObject, Scope, ScopedNodeFunc, makeCompileTimeObject } from "../types/CompileTimeObject";
import { CompileError, ParseError, makeParseError } from "../utils";
import { makeMembers, makeParseMethodCall } from "./parseDeclarations";
import { parseExpression } from "./expressionProcessor";

export const enum FindOptions {
    None = 0,
    KeysOnly = 1 << 0,
    RemovePrefix = 1 << 1,
    ValuesOnly = 1 << 2,
    DeserializeValues = 1 << 3,
    PickField0 = 1 << 4,
    PickField1 = 1 << 5
}

export function makeStorageConstructor(node: tsm.InterfaceDeclaration) {

    const members: ROR.ReadonlyRecord<string, Operation> = {
        "context": { kind: "syscall", name: "System.Storage.GetContext" },
        "readonlyContext": { kind: "syscall", name: "System.Storage.GetReadOnlyContext" },
    }

    const { left: errors, right: props } = pipe(
        members,
        ROR.collect(StringOrd)((key, value) => pipe(
            node,
            TS.getMember(key),
            O.chain(O.fromPredicate(tsm.Node.isPropertySignature)),
            O.map(sig => makeCompileTimeObject(sig, sig.getSymbolOrThrow(), { loadOps: [value] })),
            E.fromOption(() => key)
        )),
        ROA.separate
    );
    if (errors.length > 0) throw new CompileError(`unresolved ByteStringConstructor members: ${errors.join(', ')}`, node);
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError(`no symbol for ${node.getName()}`, node);

    return makeCompileTimeObject(node, symbol, { loadOps: [], getProperty: props })
}

function makeFindCall(getFindOps: (scope: Scope, node: tsm.CallExpression) => E.Either<ParseError, readonly Operation[]>): ScopedNodeFunc<tsm.CallExpression> {
    return (scope) => (node) => {
        return pipe(
            node,
            TS.getArguments,
            // get the first argument
            ROA.lookup(0),
            // default to an empty array if prefix was not provided
            O.match(
                () => E.of(ROA.of({ kind: 'pushdata', value: Uint8Array.from([]) } as Operation)),
                parseExpression(scope)
            ),
            E.bindTo("prefixOps"),
            E.bind('findOps', () => getFindOps(scope, node)),
            E.bind("thisOps", () => {
                const expr = node.getExpression();
                return tsm.Node.hasExpression(expr)
                    ? parseExpression(scope)(expr.getExpression())
                    : E.left(makeParseError(node)("expected expression"));
            }),
            E.map(({ findOps, prefixOps, thisOps }) => pipe(
                findOps,
                ROA.concat(prefixOps),
                ROA.concat(thisOps),
                ROA.append(<Operation>{ kind: "syscall", name: "System.Storage.Find" })
            ))
        );
    }
}

// function makeKeepPrefixGetOptions(findOptions: FindOptions): (scope: Scope, node: tsm.CallExpression) => E.Either<ParseError, readonly Operation[]> {

//     const trueOption = findOptions;
//     const falseOption = findOptions | FindOptions.RemovePrefix;

//     return (scope, node) => {
//         return pipe(
//             node,
//             TS.getArguments,
//             ROA.lookup(1),
//             O.match(
//                 () => E.of(ROA.of({ kind: 'pushbool', value: false } as Operation)),
//                 flow(parseExpressionAsBoolean(scope))
//             ),
//             E.map(condition => {
//                 const op = pipe(
//                     condition,
//                     ROA.filter(op => op.kind != 'noop'),
//                     single,
//                     O.toUndefined
//                 )

//                 if (op && isPushBoolOp(op)) {
//                     // if the arg is a hard coded true or false, push the appropriate option directly
//                     const option = op.value ? trueOption : falseOption;
//                     return ROA.of({ kind: 'pushint', value: BigInt(option) } as Operation)
//                 } else {
//                     // otherwise, insert a conditional to calculate the find option at runtime
//                     const whenTrue = ROA.of({ kind: 'pushint', value: BigInt(trueOption) } as Operation);
//                     const whenFalse = ROA.of({ kind: 'pushint', value: BigInt(falseOption) } as Operation);
//                     return makeConditionalExpression({ condition, whenTrue, whenFalse })
//                 }
//             })

//         )
//     };
// }

function makeReadonlyStorageContextMembers(node: tsm.InterfaceDeclaration) {
    const members: Record<string, (sig: tsm.PropertySignature | tsm.MethodSignature, symbol: tsm.Symbol) => CompileTimeObject> = {
        get: (sig, symbol) => {
            const parseCall = makeParseMethodCall({ kind: "syscall", name: "System.Storage.Get" });
            return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        },
        find: (sig, symbol) => {
            const parseCall = makeParseMethodCall({ kind: "syscall", name: "System.Storage.Find" });
            return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        },
        // entries: (sig, symbol) => {
        //     const getFindOps = makeKeepPrefixGetOptions(FindOptions.None);
        //     const parseCall: ScopedNodeFunc<tsm.CallExpression> = makeFindCall(getFindOps);
        //     return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        // },
        // keys: (sig, symbol) => {
        //     const getFindOps = makeKeepPrefixGetOptions(FindOptions.KeysOnly);
        //     const parseCall: ScopedNodeFunc<tsm.CallExpression> = makeFindCall(getFindOps);
        //     return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        // },
        // values: (sig, symbol) => {
        //     const findOps = pipe(<Operation>{ kind: 'pushint', value: BigInt(FindOptions.ValuesOnly) }, ROA.of);
        //     const parseCall: ScopedNodeFunc<tsm.CallExpression> = makeFindCall(() => E.of(findOps));
        //     return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        // },
    }

    return makeMembers(node, members);
}

export function makeReadonlyStorageContext(node: tsm.InterfaceDeclaration) {

    const props = makeReadonlyStorageContextMembers(node);
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError(`no symbol for ${node.getName()}`, node);

    return makeCompileTimeObject(node, symbol, { loadOps: [], getProperty: props })
}

export function makeStorageContext(node: tsm.InterfaceDeclaration) {
    const members: Record<string, (sig: tsm.PropertySignature | tsm.MethodSignature, symbol: tsm.Symbol) => CompileTimeObject> = {
        asReadonly: (sig, symbol) => {
            const getLoadOps: ScopedNodeFunc<tsm.Expression> = scope => node => {
                if (tsm.Node.hasExpression(node)) {
                    return pipe(
                        node.getExpression(),
                        parseExpression(scope),
                        E.map(ROA.append({ kind: "syscall", name: "System.Storage.AsReadOnly" } as Operation))
                    );
                }
                return E.left(makeParseError(node)(`invalid ByteString.length expression`));
            }
            return <CompileTimeObject>{ node: sig, symbol, getLoadOps }
        },
        put: (sig, symbol) => {
            const parseCall = makeParseMethodCall({ kind: "syscall", name: "System.Storage.Put" });
            return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        },
        delete: (sig, symbol) => {
            const parseCall = makeParseMethodCall({ kind: "syscall", name: "System.Storage.Delete" });
            return makeCompileTimeObject(sig, symbol, { loadOps: [], parseCall });
        },
    }

    let props = makeReadonlyStorageContextMembers(node);
    props = ROA.concat(makeMembers(node, members))(props);
    const symbol = node.getSymbol();
    if (!symbol) throw new CompileError(`no symbol for ${node.getName()}`, node);

    return makeCompileTimeObject(node, symbol, { loadOps: [], getProperty: props })
}
