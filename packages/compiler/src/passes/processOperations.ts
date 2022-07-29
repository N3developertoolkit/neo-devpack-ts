import * as tsm from "ts-morph";
import { CompileContext } from "../types/CompileContext";
import { CompileError } from "../compiler";
import { OperationBuilder } from "../types/OperationBuilder";
import { ConverterOptions, convertStatement } from "../convert";
import { OpCode } from "../types/OpCode";

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

        options.returnTarget.instruction = builder.push(OpCode.RET).instruction;
        op.instructions = builder.compile();
    }
}
