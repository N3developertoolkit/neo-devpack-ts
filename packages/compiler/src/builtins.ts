import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { processArguments, ProcessOptions, ProcessFunction } from "./passes/processOperations";
import { Scope, SymbolDefinition } from "./types/CompileContext";
import { NeoService, neoServices } from "./types/Instruction";
import { OpCode } from "./types/OpCode";

export type InteropCallKind = 'syscall' | 'opcode';

export interface InteropCallInfo {
    kind: InteropCallKind,
}

export interface SysCallInfo extends InteropCallInfo{
    kind: 'syscall',
    name: NeoService,
}

export function isSysCall(call: InteropCallInfo): call is SysCallInfo {
    return call.kind === 'syscall';
}

export interface OpCodeCallInfo extends InteropCallInfo {
    kind: 'opcode',
    opCode: OpCode,
    operand?: string
}

export function isOpCodeCall(call: InteropCallInfo): call is OpCodeCallInfo {
    return call.kind === 'opcode';
}

// TODO: Do we need callingConvention?
// export type InteropCallKind = 'syscall' | 'opcode' | 'callingConvention';
// export interface CallingConventionInfo extends InteropCallInfo {
//     kind: 'callingConvention',
//     convention: 'winapi' | "cdecl" | "stdcall" | "thiscall" | "fastcall",
// }

export interface BuiltInSymbolDefinition extends SymbolDefinition {
    invokeBuiltIn(node: tsm.Node, options: ProcessOptions): void;
}

export function isBuiltInSymbolDefinition(def: SymbolDefinition): def is BuiltInSymbolDefinition {
    return 'invokeBuiltIn' in def;
}

function resolveInteropCallInfo(decl: tsm.JSDocableNode & tsm.Node): ProcessFunction | undefined {

    const callInfo = new Array<InteropCallInfo>();
    for (const jsDoc of decl.getJsDocs()) {
        for (const tag of jsDoc.getTags()) {
            const tagName = tag.getTagName();
            switch (tagName) {
                case 'syscall': {
                    const syscall = tag.getCommentText();
                    if (!syscall) continue;
                    const i = neoServices.indexOf(syscall as NeoService);
                    if (i < 0) throw new Error();
                    callInfo.push({
                        kind: "syscall",
                        name: syscall as NeoService,
                    } as SysCallInfo)
                    break;
                }
                case 'opcode': 
                    throw new Error("opcode interop call not implemented");
                default:
                    throw new Error(`${tagName} interop call tag not recognized`);
            }
        }
    }
    if (callInfo.length == 0) return undefined;

    const declHasArgs = tsm.Node.isMethodSignature(decl)
        ? true
        : tsm.Node.isPropertyDeclaration(decl)
            ? false
            : undefined;
    if (declHasArgs === undefined) { throw new CompileError(`Invalid Interop Call Declaration ${decl.getKindName()}`, decl); }

    return (node, options) => {
        if (tsm.Node.isArgumented(node)) {
            if (declHasArgs) {
                processArguments(node.getArguments(), options);
            } else {
                throw new CompileError(`expected argumented node, received ${node.getKindName()}`, node);
            }
        } else {
            if (declHasArgs) {
                throw new CompileError(`expected non argumented node, received ${node.getKindName()}`, node);
            }
        }

        const { builder } = options;

        for (const call of callInfo) {
            if (isSysCall(call)) { builder.pushSysCall(call.name); } 
            // else if (isOpCodeCall(call)) {  TODO }
            else { throw new Error(`unrecognized interop call kind ${call.kind}`); }
        }
    }
}

export function resolveBuiltIn(symbol: tsm.Symbol, scope: Scope): BuiltInSymbolDefinition | undefined {
    const decl = symbol.getValueDeclaration();
    if (!decl) return undefined;
    if (!decl.getSourceFile().isDeclarationFile()) { return undefined; }

    if (tsm.Node.isJSDocable(decl)) {
        const processFunc = resolveInteropCallInfo(decl);
        if (processFunc) {
            return {
                symbol, 
                parentScope: scope, 
                invokeBuiltIn: processFunc
            };
        }
    }

    const ancestors = decl.getAncestors()
        .filter(n => !n.isKind(tsm.SyntaxKind.SourceFile))
        .map(a => a.getSymbolOrThrow().getName());

    if (ancestors.length == 1) {
        const parent = builtins[ancestors[0]];
        if (parent) {
            const name = symbol.getName();
            if (name in parent) {
                return {
                    symbol, 
                    parentScope: scope, 
                    invokeBuiltIn: parent[name]
                };
            }
        }
    }

    return undefined;
}

type BuiltinDefinitions = {
    [key: string]: {
        [key: string]: ProcessFunction,
    }
}

const builtins: BuiltinDefinitions = {
    ByteStringConstructor: {
        from: ByteStringConstructor_from
    },
};

function ByteStringConstructor_from(node: tsm.Node, options: ProcessOptions): void {
    // if (!tsm.Node.isCallExpression(node)) { throw new CompileError(`Invalid node kind ${node.getKindName()}`, node); }
    // const args = node.getArguments();
    // const type = args[0].getType();

    
    throw new CompileError("woops!", node);
    // if (!args) throw new Error();
    // if (args.length !== 1) throw new Error("Uint8Array.from mapfn and thisArg parameters not supported");
    // const arrayLike = args[0];
    // if (tsm.Node.isArrayLiteralExpression(arrayLike)) {
    //     convertArrayLiteralExpression(arrayLike, options);
    // } else {
    //     throw new Error("Invalid parameter")
    // }
}
