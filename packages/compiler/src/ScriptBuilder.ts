import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { Instruction } from "./types";

export class ScriptBuilder {
    private readonly instructions = new Array<Instruction>();
    private readonly sequencePoints = new Map<number, tsm.Node>();

    push(instruction: Instruction, node?: tsm.Node): void;
    push(opCode: sc.OpCode, node?: tsm.Node): void;
    push(opCode: sc.OpCode, operand: ArrayLike<number>, node?: tsm.Node): void;
    push(arg1: Instruction | sc.OpCode, arg2?: ArrayLike<number> | tsm.Node, arg3?: tsm.Node) : void {
        if (typeof arg1 === 'object') {
            if (arg2) {
                if (arg2 instanceof tsm.Node) {
                    this.doPush(arg1, arg2);
                } else {
                    throw new Error("Invalid second argument");
                }
            } else {
                this.doPush(arg1);
            }
        } else {
            if (arg2) {
                if (arg2 instanceof tsm.Node) {
                    this.doPush({opCode: arg1}, arg2);
                } else {
                    const check = arg2 instanceof Uint8Array;
                    const operand = arg2 instanceof Uint8Array ? arg2 : Uint8Array.from(arg2)
                    this.doPush({opCode: arg1, operand }, arg3);
                }
            } else {
                this.doPush({opCode: arg1});
            }
        }
    }

    private doPush(instruction: Instruction, node?: tsm.Node): void {
        const index = this.instructions.push(instruction) - 1;
        if (node) {
            this.sequencePoints.set(index, node);
        }
    }
}
