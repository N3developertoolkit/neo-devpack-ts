import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { ProcessOptions, ProcessFunction } from "./passes/processOperations";
import { Scope, SymbolDefinition } from "./types/CompileContext";
import { NeoService, neoServices } from "./types/Instruction";
import { StackItemType } from "./types/StackItem";

export interface BuiltInSymbolDefinition extends SymbolDefinition {
    invokeBuiltIn(node: tsm.Node, options: ProcessOptions): void;
}

export function isBuiltInSymbolDefinition(def: SymbolDefinition): def is BuiltInSymbolDefinition {
    return 'invokeBuiltIn' in def;
}

export function resolveBuiltIn(symbol: tsm.Symbol, scope: Scope): BuiltInSymbolDefinition | undefined {
    const decl = symbol.getValueDeclaration();
    if (!decl) return undefined;
    if (!decl.getSourceFile().isDeclarationFile()) { return undefined; }

    const ancestors = decl.getAncestors().filter(n => !n.isKind(tsm.SyntaxKind.SourceFile));
    if (ancestors.length === 1) {
        const ancestorName = ancestors[0].getSymbol()?.getName();
        const ancestorMap = ancestorName 
            ? staticBuiltIns.get(ancestorName) ?? instanceBuiltIns.get(ancestorName)
            : undefined;
        const invoke = ancestorMap?.get(symbol.getName());
        if (invoke) {
            return {
                symbol,
                parentScope: scope,
                invokeBuiltIn: invoke
            };
        }
    }

    return undefined;
}

const staticBuiltIns = new Map<string, Map<string, ProcessFunction>>([
    ["ByteStringConstructor", new Map<string, ProcessFunction>([
        ["from", ByteStringConstructor_from],
    ])],
    ["StorageConstructor", new Map<string, ProcessFunction>([
        ["currentContext", (node: tsm.Node, options: ProcessOptions) => {
            processSysCall("System.Storage.GetContext", options);
        }],
        ["get", (node: tsm.Node, options: ProcessOptions) => {
            processSysCall("System.Storage.Get", options);
        }],
        ["put", (node: tsm.Node, options: ProcessOptions) => {
            processSysCall("System.Storage.Put", options);
        }],
        ["delete", (node: tsm.Node, options: ProcessOptions) => {
            processSysCall("System.Storage.Delete", options);
        }],
    ])]
])

const instanceBuiltIns = new Map<string, Map<string, ProcessFunction>>([
    ["ByteString", new Map<string, ProcessFunction>([
        ["toBigInt", ByteString_toBigInt],
    ])]
])

function processSysCall(syscall: NeoService, options: ProcessOptions) {
    options.builder.pushSysCall(syscall);
}

function ByteString_toBigInt(node: tsm.Node, options: ProcessOptions): void {
    options.builder.pushConvert(StackItemType.Integer);
}

class ByteStringBuilder {
    private readonly buffer = new Array<number>();
    push(value: number | bigint) {
        if (typeof value === 'bigint') {
            value = Number(value);
        }
        if (value < 0 || value > 255) throw new Error("Invalid byte value");
        this.buffer.push(value);
    }
    get value() { return Uint8Array.from(this.buffer); }

}

function ByteStringConstructor_from(node: tsm.Node, options: ProcessOptions): void {
    const { builder, scope } = options;
    builder.pushConvert(StackItemType.ByteString);
    return;
    // if (!tsm.Node.isCallExpression(node)) { throw new CompileError(`Invalid node kind ${node.getKindName()}`, node); }
    // const arg = node.getArguments()[0];
    // if (!tsm.Node.isExpression(arg)) throw new CompileError(`Expected expression`, arg);
    // if (tsm.Node.isArrayLiteralExpression(arg)) {
    //     const buffer = new ByteStringBuilder();
    //     for (const e of arg.getElements()) {
    //         dispatch(e, undefined, {
    //             [tsm.SyntaxKind.NumericLiteral]: (node) => {
    //                 const literal = getNumericLiteral(node);
    //                 if (literal < 0 || literal >= 256) throw new CompileError("Invalid byte value", node);
    //                 buffer.push(literal);
    //             },
    //             [tsm.SyntaxKind.Identifier]: (node) => {
    //                 const resolved = scope.resolve(node.getSymbolOrThrow());
    //                 if (resolved instanceof ConstantValueSymbolDefinition) {
    //                     if (typeof resolved.value === 'number') {
    //                         buffer.push(resolved.value);
    //                     } else if (typeof resolved.value === 'bigint') {
    //                         buffer.push(resolved.value);
    //                     } else { 
    //                         throw new CompileError("invalid constant value type", node); 
    //                     }
    //                 }
    //             }
    //         })
    //     }
    //     builder.pushData(buffer.value);
    //     return;
    // }
    // throw new CompileError("ByteStringConstructor.from not supported", arg);
}
