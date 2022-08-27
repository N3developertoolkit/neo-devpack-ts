import * as tsm from "ts-morph";
import { CompileContext } from "../compiler";
import { FunctionSymbolDef } from "../scope";
import { OpCode } from "../types/OpCode";

export interface VMInstruction {
    opCode: OpCode;
    operand: Uint8Array | undefined;
}

export function processFooPass(context: CompileContext): void {
    for (const symbolDef of context.globals.symbolDefs) {
        if (symbolDef instanceof FunctionSymbolDef) {

        }
    }
}