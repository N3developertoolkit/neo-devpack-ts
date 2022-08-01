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
};

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
