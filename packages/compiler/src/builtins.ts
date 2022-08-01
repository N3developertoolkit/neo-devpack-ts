import { buffer } from "stream/consumers";
import * as tsm from "ts-morph";
import { CompileError } from "./compiler";
import { convertArrayLiteralExpression, ConverterOptions, convertExpression  } from "./convert";
import { NeoService } from "./types/Instruction";
import { StackItemType } from "./types/StackItem";

type ConvertFunction = (options: ConverterOptions, args?: Array<tsm.Node>) => void;

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

function Uint8Array_from(options: ConverterOptions, args?: Array<tsm.Node>): void {
    if (!args) throw new Error();
    if (args.length !== 1) throw new Error("Uint8Array.from mapfn and thisArg parameters not supported");
    const arrayLike = args[0];
    if (tsm.Node.isArrayLiteralExpression(arrayLike)) {
        convertArrayLiteralExpression(arrayLike, options);
    } else {
        throw new Error("Invalid parameter")
    }
}
