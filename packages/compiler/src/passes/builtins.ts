import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";
import { flow, identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord'
import * as O from 'fp-ts/Option'
import * as TS from "../TS";

import { CompilerState } from "../types/CompileOptions";
import { CompileTimeObject, CompileTimeObjectOptions, Scope, ScopedNodeFunc, createEmptyScope, createScope, makeCompileTimeObject } from "../types/CompileTimeObject";
import { CompileError, createDiagnostic, isArray, isVoidLike, makeParseError, single, ParseError } from "../utils";
import { Operation, parseOperation } from "../types/Operation";

import { parseExpression } from "./expressionProcessor";
import { LibraryDeclaration } from "../types/LibraryDeclaration";
import { parseArguments, parseCallExpression, parseEnumDecl } from "./parseDeclarations";
import { makeByteStringConstructor, makeByteStringInterface } from "./builtins.ByteString";
import { makeStorageConstructor } from "./builtins.Storage";

module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

function makeParseCall(callOps: Operation | readonly Operation[]): ScopedNodeFunc<tsm.CallExpression> {
    return (scope: Scope) => (node: tsm.CallExpression) => pipe(
        node,
        parseCallExpression(scope),
        E.map(ROA.concat(isArray(callOps) ? callOps : [callOps]))
    )
}

function makeStackItemType(decl: tsm.InterfaceDeclaration) {
    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError("symbol not found", decl);

    return pipe(
        // stack items interfaces don't extend other interfaces, so use getMembers instead of type.getProperties
        decl.getMembers(),
        ROA.mapWithIndex((index, member) => pipe(
            member,
            // stack itemn interface members are exclusively properties
            E.fromPredicate(tsm.Node.isPropertySignature, () => member.getSymbol()?.getName() ?? "<unknown>"),
            E.chain(flow(TS.getSymbol, E.fromOption(() => "symbol not found"))),
            // for each property, create a CTO that picks item by index
            E.map(symbol => {
                return makeCompileTimeObject(member, symbol, {
                    loadOps: [
                        { kind: 'pushint', value: BigInt(index) },
                        { kind: 'pickitem' }
                    ]
                });
            })
        )),
        ROA.sequence(E.Applicative),
        E.map(props => makeCompileTimeObject(decl, symbol, { getProperty: props })),
        E.match(e => { throw new CompileError(e, decl) }, identity)
    )
}

function makeEnumObject(decl: tsm.EnumDeclaration) {
    return pipe(
        decl,
        parseEnumDecl,
        E.match(e => { throw new CompileError(e.message, decl); }, identity)
    )
}

const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\}/;
function makeNativeContractType(decl: tsm.InterfaceDeclaration) {
    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError("symbol not found", decl);

    return pipe(
        decl,
        TS.getTagComment("nativeContract"),
        O.chain(REGEX.match(regexMethodToken)),
        O.chain(ROA.lookup(1)),
        O.map(v => u.HexString.fromHex(v, true)),
        E.fromOption(() => `invalid hash for ${decl.getSymbol()?.getName()} native contract declaration`),
        E.map(hash => {
            return pipe(
                // native contract interfaces can extend other native contract interfaces
                // (NeoToken extends FungibleToken), so use type.getProperties instead of getMembers
                decl.getType().getProperties(),
                ROA.chain(s => s.getDeclarations()),
                ROA.filter(TS.isMethodOrProp),
                ROA.map(makeMember(hash)),
            );
        }),
        E.map(props => makeCompileTimeObject(decl, symbol, { getProperty: props })),
        E.match(e => { throw new CompileError(e, decl) }, identity)
    )

    function makeMember(hash: u.HexString) {
        return (member: tsm.MethodSignature | tsm.PropertySignature) => {
            const memberSymbol = member.getSymbol();
            if (!memberSymbol) throw new CompileError("symbol not found", member);
            const memberName = pipe(
                member,
                TS.getTagComment("nativeContract"),
                O.getOrElse(() => memberSymbol.getName())
            );
            const [parametersCount, returnType] = tsm.Node.isPropertySignature(member)
                ? [0, member.getType()]
                : [member.getParameters().length, member.getReturnType()];
            const token = new sc.MethodToken({
                hash: hash.toString(),
                method: memberName,
                parametersCount: parametersCount,
                hasReturnValue: !isVoidLike(returnType),
                callFlags: sc.CallFlags.All
            });
            const callTokenOp = <Operation>{ kind: "calltoken", token };
            let options: CompileTimeObjectOptions = {};
            if (tsm.Node.isMethodSignature(member)) {
                options = { parseCall: makeParseCall(callTokenOp) };
            } else {
                options = { loadOps: [callTokenOp] };
            }
            return makeCompileTimeObject(member, memberSymbol, options);
        };
    }
}

function makeNativeContractObject(decl: tsm.VariableDeclaration) {
    return pipe(
        decl,
        TS.getSymbol,
        O.match(
            () => { throw new CompileError("symbol not found", decl); },
            symbol => makeCompileTimeObject(decl, symbol, {})
        ),
    )
}

function makeSysCallFunctionObject(decl: tsm.FunctionDeclaration) {
    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError("symbol not found", decl);

    return pipe(
        decl,
        TS.getTagComment('syscall'),
        E.fromOption(() => `Invalid @syscall tag for ${decl.getSymbol()?.getName()}`),
        E.map(serviceName => {
            const parseCall = makeParseCall({ kind: "syscall", name: serviceName });
            return makeCompileTimeObject(decl, symbol, { parseCall });
        }),
        E.match(e => { throw new CompileError(e, decl) }, identity)
    )
}

const regexOperationTagComment = /(\S+)\s?(\S+)?/
function makeOperationsFunctionObject(decl: tsm.FunctionDeclaration) {

    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError("symbol not found", decl);

    return pipe(
        decl.getJsDocs(),
        ROA.chain(d => d.getTags()),
        ROA.filter(t => t.getTagName() === 'operation'),
        ROA.map(t => t.getCommentText() ?? ""),
        ROA.map(parseOperationTagComment),
        ROA.sequence(E.Applicative),
        E.map(ops => makeCompileTimeObject(decl, symbol, { parseCall: makeParseCall(ops) })),
        E.match(e => { throw new CompileError(e, decl) }, identity)
    )

    // like standard parseArguments in ExpressionProcessor.ts, but without the argument reverse
    // Right now (nep11 spike) there is only one @operation function (concat). It probably makes 
    // sense to move this to ByteArray or ByteArrayConstructor instead of a free function
    function makeParseCall(callOps: readonly Operation[]): ScopedNodeFunc<tsm.CallExpression> {
        return (scope: Scope) => (node: tsm.CallExpression) => pipe(
            node,
            TS.getArguments,
            ROA.map(parseExpression(scope)),
            ROA.sequence(E.Applicative),
            E.map(ROA.flatten),
            E.map(ROA.concat(callOps))
        )
    }

    function parseOperationTagComment(comment: string): E.Either<string, Operation> {
        const matches = comment.match(regexOperationTagComment) ?? [];
        return matches.length === 3
            ? pipe(
                parseOperation(matches[1], matches[2]),
                E.fromNullable(comment)
            )
            : E.left(comment);
    }
}

function makeCallContractFunctionObject(decl: tsm.FunctionDeclaration) {
    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError("symbol not found", decl);

    const parseCall: ScopedNodeFunc<tsm.CallExpression> = (scope: Scope) => (node: tsm.CallExpression) => {
        const args = TS.getArguments(node);
        const callArgs = args.slice(0, 3);
        const targetArgs = args.slice(3);

        if (callArgs.length !== 3) return E.left(makeParseError(node)(`invalid arg count ${args.length}`));

        return pipe(
            targetArgs,
            parseArguments(scope),
            E.map(ROA.concat([
                { kind: "pushint", value: BigInt(targetArgs.length) },
                { kind: 'packarray' },
            ] as readonly Operation[])),
            E.bindTo("target"),
            E.bind('call', () => pipe(
                callArgs,
                parseArguments(scope),
                E.map(ROA.append({ kind: "syscall", name: "System.Contract.Call" } as Operation))
            )),
            E.map(({ call, target }) => ROA.concat(call)(target))

        );
    }

    return makeCompileTimeObject(decl, symbol, { parseCall });
}

function makeRuntimeConstructorType(decl: tsm.InterfaceDeclaration) {
    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError("symbol not found", decl);
    return pipe(
        // RuntimeConstructor doesn't extend another interface, so use getMembers instead of type.getProperties
        decl.getMembers(),
        ROA.map(member => pipe(
            member,
            // RuntimeConstructor members are exclusively properties
            E.fromPredicate(tsm.Node.isPropertySignature, () => member.getSymbol()?.getName() ?? "<unknown>"),
            E.chain(flow(TS.getSymbol, E.fromOption(() => "symbol not found"))),
            E.bindTo('symbol'),
            // each runtime ctor property has a @syscall tag
            E.bind('syscall', () => pipe(
                member,
                TS.getTagComment('syscall'),
                E.fromOption(() => "syscall tag not found")
            )),
            E.map(({ symbol, syscall }) => {
                const loadOp = <Operation>{ kind: "syscall", name: syscall };
                return makeCompileTimeObject(member, symbol, { loadOps: [loadOp] });
            })
        )),
        ROA.sequence(E.Applicative),
        E.map(props => makeCompileTimeObject(decl, symbol, { getProperty: props })),
        E.match(e => { throw new CompileError(e, decl) }, identity)
    )
}

const invokeError = (scope: Scope) => (args: readonly tsm.Expression[]): E.Either<ParseError, readonly Operation[]> => {
    return args.length === 0
        ? E.of([{ kind: 'pushdata', value: Buffer.from("", "utf8") } as Operation])
        : parseExpression(scope)(args[0]);
}

const makeErrorObject = (decl: tsm.VariableDeclaration) => {
    const parseCall: ScopedNodeFunc<tsm.CallExpression> = scope => node => invokeError(scope)(TS.getArguments(node))
    const parseConstructor: ScopedNodeFunc<tsm.NewExpression> = scope => node => invokeError(scope)(TS.getArguments(node))

    const symbol = decl.getSymbol();
    if (!symbol) throw new CompileError("symbol not found", decl);
    return makeCompileTimeObject(decl, symbol, { parseCall, parseConstructor });
}

const isFunctionDeclaration = O.fromPredicate(tsm.Node.isFunctionDeclaration);
const isInterfaceDeclaration = O.fromPredicate(tsm.Node.isInterfaceDeclaration);
const isVariableStatement = O.fromPredicate(tsm.Node.isVariableStatement);
const isEnumDeclaration = O.fromPredicate(tsm.Node.isEnumDeclaration);


function makeStaticVariable(name: string, variables: readonly tsm.VariableDeclaration[]) {
    return pipe(
        variables,
        ROA.findFirst(v => v.getName() === name),
        O.bindTo("decl"),
        O.bind("symbol", ({ decl }) => pipe(decl, TS.getSymbol)),
        O.map(({ decl, symbol }) => makeCompileTimeObject(decl, symbol, { loadOps: [] })),
        O.match(() => { throw new Error(`${name} built-in not found`); }, identity)
    )
}
export const makeGlobalScope =
    (decls: readonly LibraryDeclaration[]): CompilerState<Scope> =>
        diagnostics => {

            const functions = pipe(decls, ROA.filterMap(isFunctionDeclaration));
            const interfaces = pipe(decls, ROA.filterMap(isInterfaceDeclaration));
            const varStmts = pipe(decls, ROA.filterMap(isVariableStatement));
            const varDecls = pipe(varStmts, ROA.chain(s => s.getDeclarations()));

            const makeInterface = (name: string, factory: (decl: tsm.InterfaceDeclaration) => CompileTimeObject) => {
                return pipe(
                    interfaces,
                    ROA.findFirst(i => i.getName() === name),
                    O.map(factory),
                    O.match(
                        () => { throw new Error(`${name} not found`) },
                        identity
                    )
                )
            }

            const q = varDecls.map(d => d.getName());

            varDecls.find(d => d.getName() === "ByteString")

            const byteStringVar = makeStaticVariable("ByteString", varDecls);
            const storageVar = makeStaticVariable("Storage", varDecls);
            // const runtimeVar = makeStaticVariable("Runtime", varDecls);

            const byteStringCtorType = makeInterface("ByteStringConstructor", makeByteStringConstructor);
            const byteStringType = makeInterface("ByteString", makeByteStringInterface);
            const storageCtorType = makeInterface("StorageConstructor", makeStorageConstructor);

            let typeDefs: ReadonlyArray<CompileTimeObject> = [byteStringCtorType, byteStringType, storageCtorType];
            let symbolDefs: ReadonlyArray<CompileTimeObject> = [byteStringVar, storageVar]


            // const enumObjects = pipe(
            //     decls, 
            //     ROA.filterMap(isEnumDeclaration), 
            //     ROA.map(makeEnumObject)
            // );

            // const nativeContractObjects = pipe(
            //     decls,
            //     ROA.filterMap(isVariableStatement),
            //     ROA.filter(TS.hasTag("nativeContract")),
            //     ROA.chain(s => s.getDeclarations()),
            //     ROA.map(makeNativeContractObject)
            // );

            // const sysCallFunctionObjects = pipe(
            //     functions,
            //     ROA.filter(TS.hasTag("syscall")),
            //     ROA.map(makeSysCallFunctionObject)
            // )

            // const operationFunctionObjects = pipe(
            //     functions,
            //     ROA.filter(TS.hasTag("operation")),
            //     ROA.map(makeOperationsFunctionObject)
            // )

            // const stackItemTypes = pipe(
            //     interfaces,
            //     ROA.filter(TS.hasTag("stackitem")),
            //     ROA.map(makeStackItemType),
            // )

            // const nativeContractTypes = pipe(
            //     interfaces,
            //     ROA.filter(TS.hasTag("nativeContract")),
            //     ROA.map(makeNativeContractType),
            // )


            // interface Error {
            //     name: string;
            //     message: string;
            //     stack?: string;
            // }

            // interface ErrorConstructor {
            //     new(message?: string): Error;
            //     (message?: string): Error;
            //     readonly prototype: Error;
            // }

            // declare var Error: ErrorConstructor;




            // const callContractFuncObject = makeDeclaration("callContract", makeCallContractFunctionObject);

            // pipe(
            //     "callContract",
            //     getDeclaration,
            //     O.map(decl => makeCallContractFunctionObject(decl as tsm.FunctionDeclaration)),
            //     O.match(() => { throw new Error("callContract function not found") }, identity)
            // );

            // const runtimeCtorType = pipe(
            //     "RuntimeConstructor",
            //     getDeclaration,
            //     O.map(decl => makeRuntimeConstructorType(decl as tsm.InterfaceDeclaration)),
            //     O.match(() => { throw new Error("RuntimeConstructor interface not found") }, identity)
            // );

            // const runtimeObj = pipe(
            //     "Runtime",
            //     getDeclaration,
            //     O.map(decl => {
            //         const symbol = decl.getSymbol();
            //         if (!symbol) throw new CompileError("symbol not found", decl);
            //         return makeCompileTimeObject(decl, symbol, {});
            //     }),
            //     O.match(() => { throw new Error("Runtime variable declaration not found") }, identity)
            // );

            // const errorObj = pipe(
            //     "ErrorConstructor",
            //     getDeclaration,
            //     O.map(decl => makeErrorObject(decl as tsm.VariableDeclaration)),
            //     O.match(() => { throw new Error("Error variable declaration not found") }, identity)
            // );




            // const builtInFunctions: Record<string, (decl: tsm.FunctionDeclaration) => CompileTimeObject> = {
            //     "callContract": makeCallContractFunctionObject,
            // }



            // const builtInInterfaces: Record<string, (decl: tsm.InterfaceDeclaration) => CompileTimeObject> = {
            // //     "RuntimeConstructor": makeRuntimeConstructorType,



            // //     // "ByteStringConstructor": makeByteStringConstructor,
            // //     // "ByteString": makeByteStringInterface,
            // //     // "Iterator": makeIteratorInterface,
            // //     // "ReadonlyStorageContext": makeReadonlyStorageContext,
            // //     // "StorageConstructor": makeStorageConstructor,
            // //     // "StorageContext": makeStorageContext,
            // }

            // const builtInVars: Record<string, (decl: tsm.VariableDeclaration) => CompileTimeObject> = {
            //     "Error": makeErrorObject,

            //     // "Runtime": createBuiltInSymbol,




            //     // "ByteString": createBuiltInSymbol,
            //     // "Storage": createBuiltInSymbol,
            // }




            return pipe(
                createScope()(symbolDefs, typeDefs),
                E.match(
                    error => {
                        diagnostics = ROA.append(createDiagnostic(error))(diagnostics);
                        return [createEmptyScope(), diagnostics];
                    },
                    scope => {
                        return [scope, diagnostics];
                    }
                )
            );


            // function makeDeclaration(name: string, func: (decl: BuiltinDeclaration) => CompileTimeObject): CompileTimeObject {

            //     for (const decl of decls) {
            //         if (tsm.Node.isVariableStatement(decl)) {
            //             const varDecl = decl.getDeclarations().find(decl => decl.getSymbol()?.getName() === name)
            //             if (varDecl) return func(varDecl);
            //         }
            //         else {
            //             if (decl.getSymbol()?.getName() === name) return func(decl);
            //         }
            //     }

            //     throw new Error(`${name} declaration not found`) 
            // }

        }

export type BuiltinDeclaration = tsm.EnumDeclaration | tsm.FunctionDeclaration | tsm.InterfaceDeclaration | tsm.VariableDeclaration;

// const resolveBuiltins =
//     <T extends BuiltinDeclaration>(map: ROR.ReadonlyRecord<string, (decl: T) => CompileTimeObject>) =>
//         (declarations: readonly T[]) =>
//             (symbolDefs: readonly CompileTimeObject[]) => {
//                 const defs = pipe(
//                     map,
//                     ROR.mapWithIndex((key, func) => pipe(
//                         declarations,
//                         ROA.filter(d => d.getName() === key),
//                         single,
//                         O.map(func),
//                         E.fromOption(() => key),
//                     )),
//                     rorValues,
//                     checkErrors('unresolved built in variables'),
//                 )
//                 return ROA.concat(defs)(symbolDefs);
//             }