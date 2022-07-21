import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { OpCodeAnnotations } from "./opCodeAnnotations";

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

/* spell-checker: disable */
function isOffsetOpCode(opCode: sc.OpCode) {
    switch (opCode) {
        case sc.OpCode.JMP:
        case sc.OpCode.JMP_L:
        case sc.OpCode.JMPIF:
        case sc.OpCode.JMPIF_L:
        case sc.OpCode.JMPIFNOT:
        case sc.OpCode.JMPIFNOT_L:
        case sc.OpCode.JMPEQ:
        case sc.OpCode.JMPEQ_L:
        case sc.OpCode.JMPNE:
        case sc.OpCode.JMPNE_L:
        case sc.OpCode.JMPGT:
        case sc.OpCode.JMPGT_L:
        case sc.OpCode.JMPGE:
        case sc.OpCode.JMPGE_L:
        case sc.OpCode.JMPLT:
        case sc.OpCode.JMPLT_L:
        case sc.OpCode.JMPLE:
        case sc.OpCode.JMPLE_L:
        case sc.OpCode.CALL:
        case sc.OpCode.CALL_L:
        case sc.OpCode.PUSHA:
        case sc.OpCode.ENDTRY:
        case sc.OpCode.ENDTRY_L:
            return true;
        default:
            return false;
    }
}
/* spell-checker: enable */

function isTryOpCode(opCode: sc.OpCode) {
    return opCode === sc.OpCode.TRY
        || opCode === sc.OpCode.TRY_L;
}

function offset8(index: number, offset: number): number {
    return offset - index;
}

function offset32(index: number, offset: number): Uint8Array {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(offset8(index, offset));
    return buffer;
}

export class ScriptBuilder {
    private readonly _instructions = new Array<Instruction>();
    private readonly _sourceReferences = new Map<number, tsm.Node>();

    get instructions() {
        return this._instructions.map((instruction, i) => ({
            instruction,
            sourceReference: this._sourceReferences.get(i)
        }));
    }

    nodeSetter(): SourceReferenceSetter {
        const length = this._instructions.length;
        return {
            instruction: undefined,
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
        const index = this._instructions.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) { this._sourceReferences.set(index, node); }
            }
        }
    }

    compile(offset: number) {

        const length = this._instructions.length;
        const insMap = new Map<Instruction, number>();
        let position = 0;
        for (let i = 0; i < length; i++) {
            const ins = this._instructions[i];
            insMap.set(ins, position);

            // every instruction is at least one byte long for the opCode
            position += 1;
            const annotation = OpCodeAnnotations[ins.opCode];
            if (annotation.operandSize) {
                // if operandSize is specified, use it instead of the instruction operand
                // since offset target instructions will have invalid operand
                position += (annotation.operandSize);
            } else if (annotation.operandSizePrefix) {
                // if operandSizePrefix is specified, use the instruction operand length
                position += (ins.operand!.length);
            }
        }

        let script = new Array<number>();
        let references = new Map<number, tsm.Node>();

        for (let i = 0; i < length; i++) {
            const node = this._sourceReferences.get(i)
            if (node) {
                references.set(offset + script.length, node);
            }

            const ins = this._instructions[i];
            const annotation = OpCodeAnnotations[ins.opCode];
            if (isTryOpCode(ins.opCode)) {
                if (!ins.target || !ins.target.instruction) throw new Error("Missing catch offset instruction");
                if (!ins.finallyTarget || !ins.finallyTarget.instruction) throw new Error("Missing finally offset instruction");
                const catchOffset = insMap.get(ins.target.instruction);
                if (!catchOffset) throw new Error("Invalid catch offset instruction");
                const fetchOffset = insMap.get(ins.finallyTarget.instruction);
                if (!fetchOffset) throw new Error("Invalid finally offset instruction");
                if (annotation.operandSize === 2) {
                    script.push(ins.opCode, offset8(script.length, catchOffset), offset8(script.length, fetchOffset));
                } else {
                    script.push(ins.opCode, ...offset32(script.length, catchOffset), ...offset32(script.length, fetchOffset));
                }
            } else if (isOffsetOpCode(ins.opCode)) {
                if (!ins.target || !ins.target.instruction) throw new Error("Missing target offset instruction");
                const offset = insMap.get(ins.target.instruction);
                if (!offset) throw new Error("Invalid target offset instruction");
                if (annotation.operandSize === 1) {
                    script.push(ins.opCode, offset8(script.length, offset));
                } else {
                    script.push(ins.opCode, ...offset32(script.length, offset));
                }
            } else {
                const bytes = ins.operand ? [ins.opCode, ...ins.operand] : [ins.opCode];
                script.push(...bytes);
            }
        }

        return {
            script: Uint8Array.from(script),
            sourceReferences: references
        };
    }
}
