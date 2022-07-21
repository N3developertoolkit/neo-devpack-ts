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

function offset32(offset: number): Uint8Array {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(offset);
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
            set: (node?) => {
                if (node && length < this._instructions.length) {
                    this._sourceReferences.set(length, node)
                }
            }
        }
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
        const newLength = this._instructions.push(ins);
        return {
            set: (node?) => {
                if (node) { this._sourceReferences.set(newLength - 1, node); }
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
                const catchOffset = insMap.get(ins.target!.instruction!);
                if (!catchOffset) throw new Error();
                const fetchOffset = insMap.get(ins.finallyTarget!.instruction!);
                if (!fetchOffset) throw new Error();
                if (annotation.operandSize === 2) {
                    script.push(ins.opCode, catchOffset, fetchOffset);
                } else {
                    script.push(ins.opCode, ...offset32(catchOffset), ...offset32(fetchOffset));
                }
            } else if (isOffsetOpCode(ins.opCode)) {
                const offset = insMap.get(ins.target!.instruction!);
                if (!offset) throw new Error();
                if (annotation.operandSize === 1) {
                    script.push(ins.opCode, offset);
                } else {
                    script.push(ins.opCode, ...offset32(offset));
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
