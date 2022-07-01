import { sc } from "@cityofzion/neon-core";
import { BinaryExpression, Expression, SyntaxKind, Type, TypeFlags } from "ts-morph";
import { ContractType, ContractTypeKind, PrimitiveContractType, PrimitiveType } from "./contractType";
import { Instruction } from "./Instruction";

export function convertBuffer(buffer: Buffer) {

    if (buffer.length <= 255) {
        const operand = new Uint8Array(buffer.length + 1);
        operand[0] = buffer.length;
        buffer.copy(operand, 1);
        return [new Instruction(sc.OpCode.PUSHDATA1, operand)];
    }

    throw new Error(`convertBuffer for length ${buffer.length} not implemented`);
}

export function convertBinaryOperator(node: BinaryExpression) {
    const op = node.getOperatorToken();
    switch (op.getKind()) {
        case SyntaxKind.PlusToken: {
            const left = node.getLeft();
            const right = node.getRight();
            if (isStringType(left) && isStringType(right)) {
                return [new Instruction(sc.OpCode.CAT)]
            } else {
                throw new Error(`convertBinaryOperator.PlusToken not implemented for ${left.getType().getText()} and ${right.getType().getText()}`);
            }
        }
        default:
            throw new Error(`convertOperator ${op.getKindName()} not implemented`);
    }

    function isStringType(exp: Expression) {
        const flags = exp.getType().getFlags();
        return (flags & TypeFlags.String) || (flags & TypeFlags.StringLiteral);
    }
}



