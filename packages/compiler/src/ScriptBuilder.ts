import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";

export interface Instruction {
    opCode: sc.OpCode;
    operand?: Uint8Array;
}

export interface SequencePointSetter {
    set(node?: tsm.Node): void;
}

export class ScriptBuilder {
    private readonly _instructions = new Array<Instruction>();
    private readonly _sequencePoints = new Map<number, tsm.Node>();

    get instructions() {
        return this._instructions.map((instruction, i) => ({
            instruction,
            sequencePoint: this._sequencePoints.get(i)
        }));
    }

    nodeSetter(): SequencePointSetter {
        const length = this._instructions.length;
        return {
            set: (node?) => {
                if (node && length < this._instructions.length) {
                    this._sequencePoints.set(length, node)
                }
            }
        }
    }

    push(instruction: Instruction): SequencePointSetter;
    push(opCode: sc.OpCode): SequencePointSetter;
    push(opCode: sc.OpCode, operand: ArrayLike<number>): SequencePointSetter;
    push(arg1: Instruction | sc.OpCode, arg2?: ArrayLike<number>): SequencePointSetter {
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

    private pushHelper(ins: Instruction): SequencePointSetter {
        const newLength = this._instructions.push(ins);
        return {
            set: (node?) => {
                if (node) { this._sequencePoints.set(newLength - 1, node); }
            }
        }
    }

    compile(offset: number) {
        let script = new Array<number>();
        let points = new Map<number, tsm.Node>();

        const length = this._instructions.length;
        for (let i = 0; i < length; i++) {
            const node = this._sequencePoints.get(i)
            if (node) {
                points.set(offset + script.length, node);
            }
            const ins = this._instructions[i];
            const bytes = ins.operand ? [ins.opCode, ...ins.operand] : [ins.opCode];
            script.push(...bytes);
        }
        return {
            script: Uint8Array.from(script),
            sequencePoints: points
        };
    }
}
