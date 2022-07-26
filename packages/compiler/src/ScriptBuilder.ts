import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { getPrefix, isPushDataOpCode, isTargetOpCode, isTryOpCode, OpCodeAnnotations } from "./opCodeAnnotations";

export interface OffsetTarget {
    instruction?: Instruction
}
export interface Instruction {
    opCode: sc.OpCode;
    operand?: Uint8Array;
    target?: OffsetTarget;
    finallyTarget?: OffsetTarget;
}

export interface SourceReferenceSetter {
    readonly instruction: Instruction | undefined;
    set(node?: tsm.Node): void;
}

export class ScriptBuilder {
    private readonly _instructions = new Array<Instruction>();
    private readonly _sourceReferences = new Map<number, tsm.Node>();

    getScript() {
        return {
            instructions: this._instructions,
            sourceReferences: this._sourceReferences
        }
    }

    get instructions() {
        return this._instructions.map((instruction, i) => ({
            instruction,
            sourceReference: this._sourceReferences.get(i)
        }));
    }

    getRefSetter(): { set(node?: tsm.Node): void } {
        const length = this._instructions.length;
        return {
            set: (node?) => {
                if (node && length < this._instructions.length) {
                    this._sourceReferences.set(length, node)
                }
            }
        }
    }

    pushTarget(opCode: sc.OpCode, target: OffsetTarget, finallyTarget?: OffsetTarget): SourceReferenceSetter {
        return this.pushHelper({ opCode, target, finallyTarget });
    }

    push(instruction: Instruction): SourceReferenceSetter;
    push(opCode: sc.OpCode): SourceReferenceSetter;
    push(opCode: sc.OpCode, operand: ArrayLike<number>): SourceReferenceSetter;
    push(arg1: Instruction | sc.OpCode, arg2?: ArrayLike<number>): SourceReferenceSetter {
        if (typeof arg1 === 'object') {
            if (arg2) { throw new Error("Invalid second argument"); }
            return this.pushHelper(arg1);
        } else {
            const operand = arg2
                ? arg2 instanceof Uint8Array
                    ? arg2
                    : Uint8Array.from(arg2)
                : undefined;
            return this.pushHelper({ opCode: arg1, operand });
        }
    }

    private pushHelper(ins: Instruction): SourceReferenceSetter {
        // validate instruction 
        const { opCode, operand, target, finallyTarget} = ins;
        switch (true) {
            case isTryOpCode(opCode): 
                if (!target || !finallyTarget) throw new Error(`Invalid targets for ${sc.OpCode[opCode]}`);
                break;
            case isTargetOpCode(opCode):
                if (!target) throw new Error(`Invalid target for ${sc.OpCode[opCode]}`);
                break;
            case isPushDataOpCode(opCode): {
                if (!operand) throw new Error(`Invalid PUSHDATA operand`);
                const { operandSizePrefix } = OpCodeAnnotations[opCode];
                if (!operandSizePrefix) throw new Error(`Missing operandSizePrefix for ${sc.OpCode[opCode]}`)
                const prefix = getPrefix(operandSizePrefix, operand);
                if (operand.length !== operandSizePrefix + prefix) {
                    throw new Error(`Invalid ${sc.OpCode[opCode]} operand. Expected ${prefix + operandSizePrefix}, received ${operand.length}`);
                }
                break;
            }
            default: {
                const { operandSize } = OpCodeAnnotations[opCode];
                if (operandSize) {
                    if (!operand) throw new Error(`Missing ${sc.OpCode[opCode]} operand`);
                    if (operand.length !== operandSize) throw new Error(`Invalid ${sc.OpCode[opCode]} operand. Expected ${operandSize}, received ${operand.length}`);
                }
            }
        }

        const index = this._instructions.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) { this._sourceReferences.set(index, node); }
            }
        }
    }
}
