import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";

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
export function isOffsetOpCode(opCode: sc.OpCode) {
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

export function isTryOpCode(opCode: sc.OpCode) {
    return opCode === sc.OpCode.TRY
        || opCode === sc.OpCode.TRY_L;
}

export function offset8(index: number, offset: number): number {
    return offset - index;
}

export function offset32(index: number, offset: number): Uint8Array {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(offset8(index, offset));
    return buffer;
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

    nodeSetter(): { set(node?: tsm.Node): void } {
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
        const index = this._instructions.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) { this._sourceReferences.set(index, node); }
            }
        }
    }


}
