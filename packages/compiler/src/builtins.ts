import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { convertBuffer, ConverterOptions, convertExpression, parseArrayLiteral } from "./convert";
import { NeoService } from "./types/Instruction";

export type ConvertFunction = (node: tsm.Node, options: ConverterOptions) => void;

export interface BuiltinCall {
    kind?: tsm.SyntaxKind,
    call: ConvertFunction
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

function implementSysCall(syscall: NeoService): ConvertFunction {

    return (node, options) => {
        const {  builder } = options;

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
            // no need to do anything for property access expression
        } else {
            throw new Error(`Invalid SysCall node ${node.getKindName()}`);
        }

        builder.pushSysCall(syscall);
    }
}

function Uint8Array_from(node: tsm.Node, options: ConverterOptions): void {
    if (tsm.Node.isCallExpression(node)) {
        const args = node.getArguments();
        if (args.length == 1 && tsm.Node.isArrayLiteralExpression(args[0])) {
            const buffer = parseArrayLiteral(args[0]);
            if (buffer) {
                // options.op.builder.push(convertBuffer(buffer));
                return;
            }
        }
    }

    throw new CompileError("Invalid Uint8Array_from", node);
}
