import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROR from 'fp-ts/ReadonlyRecord'
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";

import { LibraryDeclaration } from "../projectLib";
import { CompilerState } from "../types/CompileOptions";
import { createScope } from "../scope";
import { ParseError, Scope, SymbolDef } from "../types/ScopeType";
import { makeParseError } from "../symbolDef";
import { isVoidLike, single } from "../utils";
import { Operation, parseOperation as $parseOperation } from "../types/Operation";

import { getArguments, parseExpression } from "./expressionProcessor";
import { makeByteStringConstructor, makeByteStringInterface } from "./builtins.ByteString";
import { checkErrors, createBuiltInCallable, createBuiltInObject, createBuiltInSymbol, rorValues } from "./builtins.SymbolDefs";
import { makeReadonlyStorageContext, makeStorageConstructor, makeStorageContext } from "./builtins.Storage";


module REGEX {
    export const match = (regex: RegExp) => (value: string) => O.fromNullable(value.match(regex));
}

function sigToSymbolDef(sig: tsm.MethodSignature | tsm.PropertySignature, loadOps: readonly Operation[]) {
    return tsm.Node.isMethodSignature(sig)
        ? createBuiltInCallable(sig, { loadOps })
        : createBuiltInSymbol(sig, loadOps);
}

function makeSysCallInterface(decl: tsm.InterfaceDeclaration) {

    const props = pipe(
        decl.getType().getProperties(),
        ROA.chain(s => s.getDeclarations()),
        ROA.filter(TS.isMethodOrProp),
        ROA.map(member => {
            const name = pipe(
                member,
                TS.getTagComment('syscall'),
                O.toUndefined
            )
            if (!name) {
                throw new Error(`${decl.getSymbol()?.getName()} invalid syscall jsdoc tag`)
            }
            const loadOps = [{ kind: "syscall", name } as Operation];

            return sigToSymbolDef(member, loadOps);
        }),
    );
    return createBuiltInObject(decl, { props })
}








const regexMethodToken = /\{((?:0x)?[0-9a-fA-F]{40})\}/;
function makeNativeContract(decl: tsm.VariableDeclaration) {
    const hash = pipe(
        decl.getVariableStatement(),
        O.fromNullable,
        O.chain(TS.getTagComment("nativeContract")),
        O.chain(REGEX.match(regexMethodToken)),
        O.chain(ROA.lookup(1)),
        O.map(v => u.HexString.fromHex(v, true)),
        O.toUndefined,
    )

    if (!hash) {
        throw new Error(`invalid hash for ${decl.getSymbol()?.getName()} native contract declaration`);
    }

    const props = pipe(
        decl.getType().getProperties(),
        ROA.chain(s => s.getDeclarations()),
        ROA.filter(TS.isMethodOrProp),
        ROA.map(member => {
            const method = pipe(
                member,
                TS.getTagComment("nativeContract"),
                O.getOrElse(() => member.getSymbolOrThrow().getName())
            );
            const [parametersCount, returnType] = tsm.Node.isPropertySignature(member)
                ? [0, member.getType()]
                : [member.getParameters().length, member.getReturnType()];
            const token = new sc.MethodToken({
                hash: hash.toString(),
                method,
                parametersCount: parametersCount,
                hasReturnValue: !isVoidLike(returnType),
                callFlags: sc.CallFlags.All
            })
            const loadOps = [{ kind: "calltoken", token } as Operation];
            return sigToSymbolDef(member, loadOps);
        })
    );

    const typeDecl = pipe(
        decl.getType().getSymbol(),
        O.fromNullable,
        ROA.fromOption,
        ROA.chain(s => s.getDeclarations()),
        ROA.head,
        O.toUndefined
    );
    if (!typeDecl) throw new Error(`${decl.getName()} invalid type decl`)
    const varTypeDef = createBuiltInObject(typeDecl, { props })

    return [createBuiltInSymbol(decl), varTypeDef]
}


const parseArgArray = (scope: Scope) => (args: readonly tsm.Expression[]) => {
    return pipe(
        args,
        ROA.map(parseExpression(scope)),
        ROA.sequence(E.Applicative),
        E.map(ROA.reverse),
        E.map(ROA.flatten),
    );
}

export const invokeCallContract =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                getArguments,
                args => {
                    const callArgs = args.slice(0, 3);
                    if (callArgs.length !== 3) return E.left(makeParseError(node)("invalid arg count"));
                    return E.of({
                        callArgs,
                        targetArgs: args.slice(3)
                    })
                },
                E.chain(({ callArgs, targetArgs }) => {
                    return pipe(
                        targetArgs,
                        parseArgArray(scope),
                        E.map(ROA.concat([
                            { kind: "pushint", value: BigInt(targetArgs.length) },
                            { kind: 'pack' },
                        ] as readonly Operation[])),
                        E.bindTo("target"),
                        E.bind('call', () => pipe(
                            callArgs,
                            parseArgArray(scope),
                            E.map(ROA.append({ kind: "syscall", name: "System.Contract.Call" } as Operation))
                        )),
                        E.map(({ call, target }) => ROA.concat(call)(target))
                    );
                })
            );
        }

export const invokeError =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
            const args = getArguments(node);
            return args.length === 0
                ? E.right([{ kind: 'pushdata', value: Buffer.from("", "utf8") }])
                : parseExpression(scope)(args[0]);
        }

function makeSysCallFunction(decl: tsm.FunctionDeclaration) {
    const serviceName = pipe(decl, TS.getTagComment('syscall'), O.toUndefined);
    if (!serviceName) throw new Error(`Invalid @syscall function ${decl.getSymbol()?.getName()}`)
    const loadOps = [{ kind: "syscall", name: serviceName } as Operation];
    return createBuiltInCallable(decl, { loadOps });
}

function makeStackItemObject(decl: tsm.InterfaceDeclaration) {
    const props = pipe(
        decl.getMembers(),
        ROA.mapWithIndex((index, member) => pipe(
            member,
            E.fromPredicate(tsm.Node.isPropertySignature, () => member.getSymbol()?.getName() ?? "<unknown>"),
            E.map(node => createBuiltInSymbol(node, [
                { kind: 'pushint', value: BigInt(index) },
                { kind: 'pickitem' }
            ]))
        )),
        checkErrors(`invalid @stackitem interface ${decl.getSymbol()?.getName()}`)
    )
    return createBuiltInObject(decl, { props });
}

const regexOperation = /(\S+)\s?(\S+)?/
const parseOperation =
    (comment: string): E.Either<string, Operation> => {
        const matches = comment.match(regexOperation) ?? [];
        return matches.length === 3
            ? pipe(
                $parseOperation(matches[1], matches[2]),
                E.fromNullable(comment)
            )
            : E.left(comment);
    }

function makeOperationsFunction(decl: tsm.FunctionDeclaration) {
    const loadOps = pipe(
        decl.getJsDocs(),
        ROA.chain(d => d.getTags()),
        ROA.filter(t => t.getTagName() === 'operation'),
        ROA.map(t => t.getCommentText() ?? ""),
        ROA.map(parseOperation),
        checkErrors(`invalid @operation function ${decl.getSymbol()?.getName()}`)
    )

    // like standard parseArguments in ExpressionProcessor.ts, but without the argument reverse
    // Right now (nep11 spike) there is only one @operation function (concat). It probably makes 
    // sense to move this to ByteArrayInstance instead of a free function
    const parseArguments =
        (scope: Scope) =>
            (node: tsm.CallExpression) => {
                return pipe(
                    node,
                    getArguments,
                    ROA.map(parseExpression(scope)),
                    ROA.sequence(E.Applicative),
                    E.map(ROA.flatten),
                );
            }

    return createBuiltInCallable(decl, { loadOps, parseArguments });
}

function makeEnumObject(decl: tsm.EnumDeclaration) {
    const props = pipe(
        decl.getMembers(),
        ROA.map(member => {
            const value = member.getValue();
            if (value == undefined) return E.left(member.getName());
            const op: Operation = typeof value === 'number'
                ? { kind: "pushint", value: BigInt(value) }
                : { kind: "pushdata", value: Buffer.from(value, 'utf8') };
            return E.of(createBuiltInSymbol(member, [op]))
        }),
        checkErrors(`invalid EnumDeclaration ${decl.getSymbol()?.getName()}`)
    )
    return createBuiltInObject(decl, { props });
}

function makeIteratorInterface(decl: tsm.InterfaceDeclaration):SymbolDef {
    return createBuiltInSymbol(decl);
}

export const makeGlobalScope =
    (decls: readonly LibraryDeclaration[]): CompilerState<Scope> =>
        diagnostics => {

            // let symbolDefs: ReadonlyArray<SymbolDef> = pipe(
            //     decls.interfaces,
            //     ROA.filter(TS.hasTag("stackitem")),
            //     ROA.map(makeStackItemObject),
            // )

            // symbolDefs = pipe(
            //     decls.variables,
            //     ROA.filter(decl => pipe(
            //         decl.getVariableStatement(),
            //         O.fromNullable,
            //         O.map(TS.hasTag('nativeContract')),
            //         O.getOrElse(() => false)
            //     )),
            //     ROA.chain(makeNativeContract),
            //     ROA.concat(symbolDefs)
            // )

            // symbolDefs = pipe(
            //     decls.functions,
            //     ROA.filter(TS.hasTag('syscall')),
            //     ROA.map(makeSysCallFunction),
            //     ROA.concat(symbolDefs)
            // )

            // symbolDefs = pipe(
            //     decls.functions,
            //     ROA.filter(TS.hasTag('operation')),
            //     ROA.map(makeOperationsFunction),
            //     ROA.concat(symbolDefs)
            // )

            // const builtInEnums: Record<string, (decl: tsm.EnumDeclaration) => SymbolDef> = {
            //     "CallFlags": makeEnumObject,
            //     "FindOptions": makeEnumObject,
            // }

            // const builtInFunctions: Record<string, (decl: tsm.FunctionDeclaration) => SymbolDef> = {
            //     "callContract": decl => createBuiltInCallable(decl, { parseArguments: invokeCallContract }),
            // }

            // const builtInInterfaces: Record<string, (decl: tsm.InterfaceDeclaration) => SymbolDef> = {
            //     "ByteStringConstructor": makeByteStringConstructor,
            //     "ByteStringInstance": makeByteStringInterface,
            //     "Iterator": makeIteratorInterface,
            //     "ReadonlyStorageContext": makeReadonlyStorageContext,
            //     "RuntimeConstructor": makeSysCallInterface,
            //     "StorageConstructor": makeStorageConstructor,
            //     "StorageContext": makeStorageContext,
            // }

            // const builtInVars: Record<string, (decl: tsm.VariableDeclaration) => SymbolDef> = {
            //     "ByteString": createBuiltInSymbol,
            //     "Error": decl => createBuiltInCallable(decl, { parseArguments: invokeError }),
            //     "Runtime": createBuiltInSymbol,
            //     "Storage": createBuiltInSymbol,
            // }

            // symbolDefs = resolveBuiltins(builtInEnums)(decls.enums)(symbolDefs);
            // symbolDefs = resolveBuiltins(builtInFunctions)(decls.functions)(symbolDefs);
            // symbolDefs = resolveBuiltins(builtInInterfaces)(decls.interfaces)(symbolDefs);
            // symbolDefs = resolveBuiltins(builtInVars)(decls.variables)(symbolDefs);

            const scope = createScope()(ROA.empty);
            return [scope, diagnostics];
        }

// type LibraryDeclaration = tsm.EnumDeclaration | tsm.FunctionDeclaration | tsm.InterfaceDeclaration | tsm.VariableDeclaration;

// const resolveBuiltins =
//     <T extends LibraryDeclaration>(map: ROR.ReadonlyRecord<string, (decl: T) => SymbolDef>) =>
//         (declarations: readonly T[]) =>
//             (symbolDefs: readonly SymbolDef[]) => {
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