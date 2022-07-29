import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { ConverterOptions, convertExpression, parseArrayLiteral } from "./convert";
import { NeoService } from "./types/Instruction";

export type ConvertFunction = (node: tsm.Node, options: ConverterOptions) => void;

export type BuiltinDefinitions = {
    [key: string]: {
        [key: string]: ConvertFunction,
    }
}

export const builtins: BuiltinDefinitions = {
    Uint8ArrayConstructor: {
        from: Uint8Array_from
    },
    StorageConstructor: {
        currentContext: implementSysCall("System.Storage.GetContext"),
        get: implementSysCall("System.Storage.Get"),
        put: implementSysCall("System.Storage.Put")
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
    const {  builder } = options;
    if (tsm.Node.isCallExpression(node)) {
        const args = node.getArguments();
        if (args.length == 1 && tsm.Node.isArrayLiteralExpression(args[0])) {
            const buffer = parseArrayLiteral(args[0]);
            if (buffer) {
                builder.pushData(buffer);
                return;
            }
        }
    }

    throw new CompileError("Invalid Uint8Array_from", node);
}
