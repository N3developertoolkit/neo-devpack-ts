import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { ScriptBuilder } from "../ScriptBuilder";
import { CompileContext } from "../types/CompileContext";
import { CompileError } from "../compiler";
import { OperationBuilder } from "../types/OperationBuilder";
import { ConverterOptions, convertStatement } from "../convert";
import { InstructionCode } from "../types/Instruction";

export function processOperationsPass(context: CompileContext): void {
    if (!context.operations) { return; }
    const { operations } = context;
    for (const op of operations) {
        const builder = new OperationBuilder(op.parameters.length);
        const options: ConverterOptions = {
            context,
            info: op,
            builder,
            returnTarget: {
                instruction: undefined
            }
        };

        const body = op.node.getBodyOrThrow();
        if (tsm.Node.isStatement(body)) {
            convertStatement(body, options);
        } else {
            throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
        }

        options.returnTarget.instruction = builder.push(InstructionCode.RETURN).instruction;

        // op.instructions = builder.instructions;
    }
}
