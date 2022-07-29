import * as tsm from "ts-morph";
import { Instruction, JumpInstruction, JumpTarget, LoadStoreInstruction, NeoService, InstructionCode, PushDataInstruction, PushIntInstruction, SlotType, SysCallInstruction } from "./Instruction";

export interface NodeSetter {
    set(node?: tsm.Node): void;
}

type NodeSetterPlus = NodeSetter & { readonly instruction: Instruction };

export class OperationBuilder {
    private localCount: number = 0;
    private readonly _instructions = new Array<Instruction | tsm.Node>();

    constructor(readonly publicCount: number = 0) { }

    getNodeSetter(): NodeSetter {
        const length = this._instructions.length;
        return {
            set: (node?) => {
                if (node && length < this._instructions.length) {
                    this._instructions.splice(length, 0, node);
                }
            }
        }
    }

    push(instruction: Instruction): NodeSetterPlus;
    push(opCode: InstructionCode): NodeSetterPlus;
    push(arg1: Instruction | InstructionCode): NodeSetterPlus {
        const ins = typeof arg1 === 'object'
            ? arg1 : { opCode: arg1};  
        const index = this._instructions.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) { this._instructions.splice(index, 0, node); }
            }
        }
    }

    pushData(data: Uint8Array) {
        const ins = { opCode: InstructionCode.PUSHDATA, data } as PushDataInstruction;
        return this.push(ins);
    }

    pushInt(value: bigint) {
        const ins = { opCode: InstructionCode.PUSHINT, value } as PushIntInstruction;
        return this.push(ins);
    }

    pushJump(target: JumpTarget) {
        const ins = {opCode: InstructionCode.JUMP, target } as JumpInstruction;
        return this.push(ins);
    }
    
    pushLoad(slotType: SlotType, index: number) {
        const ins = {opCode: InstructionCode.LOAD, slotType, index } as LoadStoreInstruction;
        return this.push(ins);
    }

    pushSysCall(sysCall: NeoService) {
        const ins = {opCode: InstructionCode.SYSCALL, value: sysCall } as SysCallInstruction;
        return this.push(ins);
    }
}
