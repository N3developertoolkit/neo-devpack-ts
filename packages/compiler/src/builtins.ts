import { buffer } from "stream/consumers";
import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { ConverterOptions, convertExpression  } from "./convert";
import { NeoService } from "./types/Instruction";
import { StackItemType } from "./types/StackItem";

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
    // const expr = node.asKindOrThrow(tsm.SyntaxKind.CallExpression);
    // const args = expr.getArguments();
    // if (args.length !== 1) throw new CompileError("Uint8Array.from mapfn and thisArg parameters not supported", node);
    // const arrayLike = args[0];
    // if (tsm.Node.isArrayLiteralExpression(arrayLike)) {
    //     const data = parseArrayLiteral(arrayLike);
    //     if (data) {
    //         const { builder } = options;
    //         builder.pushData(data);
    //         builder.pushConvert(StackItemType.Buffer);
    //         return;
    //     }
    // }

    // throw new CompileError("Uint8Array.from only supports array literals of numeric literals", arrayLike);
}
