import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { convertBuffer, ConverterOptions, convertExpression, parseArrayLiteral } from "./convert";

export interface Builtins {
    // variables: ReadonlyMap<tsm.Symbol, tsm.Symbol>,
    // interfaces: ReadonlyMap<tsm.Symbol, Map<tsm.Symbol, VmCall[]>>,
    symbols: Map<tsm.Symbol, BuiltinCall>,
}

export interface BuiltinCall {
    kind: tsm.SyntaxKind,
    call: (node: tsm.Node, options: ConverterOptions) => void
}

export type BuiltinDefinitions = {
    [key: string]: {
        [key: string]: BuiltinCall,
    }
}

export const builtins: BuiltinDefinitions = {
    Uint8ArrayConstructor: {
        from: {
            kind: tsm.SyntaxKind.CallExpression,
            call: Uint8Array_from
        }
    },
    StorageConstructor: {
        currentContext: {
            kind: tsm.SyntaxKind.PropertyAccessExpression,
            call: implementSysCall("System.Storage.GetContext")
        },
        get: {
            kind: tsm.SyntaxKind.CallExpression,
            call: implementSysCall("System.Storage.Get")
        },
        put: {
            kind: tsm.SyntaxKind.CallExpression,
            call: implementSysCall("System.Storage.Put")
        }
    }
};

function implementSysCall(syscall: string): (node: tsm.Node, options: ConverterOptions) => void {
    return (node, options) => {
        const { op: { builder } } = options;

        if (tsm.Node.isCallExpression(node)) {
            const args = node.getArguments();
            const argsLength = args.length;
            for (let i = argsLength - 1; i >= 0; i--) {
                const arg = args[i];
                if (tsm.Node.isExpression(arg)) {
                    convertExpression(arg, options);
                } else {
                    throw new CompileError(`Expected expression, got ${arg.getKindName()}`, arg);
                }
            }
        } else if (tsm.Node.isPropertyAccessExpression(node)) {
            // no need to do anything here
        } else {
            throw new CompileError(`implementSysCall invalid node kind ${node.getKindName()}`, node)
        }

        const buffer = Buffer.from(sc.generateInteropServiceCode(syscall), 'hex');
        builder.push(sc.OpCode.SYSCALL, buffer);
    }
}

function Uint8Array_from(node: tsm.Node, options: ConverterOptions): void {
    if (tsm.Node.isCallExpression(node)) {
        const args = node.getArguments();
        if (args.length == 1 && tsm.Node.isArrayLiteralExpression(args[0])) {
            const buffer = parseArrayLiteral(args[0]);
            if (buffer) {
                options.op.builder.push(convertBuffer(buffer));
                return;
            }
        }
    }

    throw new CompileError("Invalid Uint8Array_from", node);
}
