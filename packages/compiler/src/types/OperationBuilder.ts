import * as tsm from "ts-morph";
// import { FunctionSymbolDefinition } from "../symbolTable";
// import { bigIntToByteArray, byteArrayToBigInt } from "../utils";
// import { CallInstruction, Instruction, isJumpInstruction, isTryInstruction, JumpInstruction, JumpTarget, NeoService } from "./Instruction";
// import { isJumpOpCode, JumpOpCode, OpCode, toString as opCodeToString, toString as printOpCode } from "./OpCode";
// import { StackItemType } from "./StackItem";

import { ConvertInstruction, InitSlotInstruction, Instruction, InstructionKind, JumpInstruction, JumpInstructionKind, LoadStoreInstruction, NeoService, PushBoolInstruction, PushDataInstruction, PushIntInstruction, specializedInstructionKinds, SysCallInstruction, TargetOffset } from "./Instruction";
import { StackItemType } from "./StackItem";

export interface NodeSetter {
    set(node?: tsm.Node): void;
}

type NodeSetterWithInstruction = NodeSetter & { readonly instruction: Instruction };

export type SlotType = 'local' | 'static' | 'parameter';

// const pushIntSizes = [1, 2, 4, 8, 16, 32] as const;

// export const sysCallHash: Record<NeoService, number> = {
//     ["System.Contract.Call"]: 1381727586,
//     ["System.Contract.CallNative"]: 1736177434,
//     ["System.Contract.CreateMultisigAccount"]: 166277994,
//     ["System.Contract.CreateStandardAccount"]: 42441167,
//     ["System.Contract.GetCallFlags"]: 2168117909,
//     ["System.Contract.NativeOnPersist"]: 2478627630,
//     ["System.Contract.NativePostPersist"]: 375234884,
//     ["System.Crypto.CheckMultisig"]: 987549854,
//     ["System.Crypto.CheckSig"]: 666101590,
//     ["System.Iterator.Next"]: 2632779932,
//     ["System.Iterator.Value"]: 499078387,
//     ["System.Runtime.BurnGas"]: 3163314883,
//     ["System.Runtime.CheckWitness"]: 2364286968,
//     ["System.Runtime.GasLeft"]: 3470297108,
//     ["System.Runtime.GetAddressVersion"]: 3700574540,
//     ["System.Runtime.GetCallingScriptHash"]: 1013863225,
//     ["System.Runtime.GetEntryScriptHash"]: 954381561,
//     ["System.Runtime.GetExecutingScriptHash"]: 1957232347,
//     ["System.Runtime.GetInvocationCounter"]: 1125197700,
//     ["System.Runtime.GetNetwork"]: 3768646597,
//     ["System.Runtime.GetNotifications"]: 4046799655,
//     ["System.Runtime.GetRandom"]: 682221163,
//     ["System.Runtime.GetScriptContainer"]: 805851437,
//     ["System.Runtime.GetTime"]: 59294647,
//     ["System.Runtime.GetTrigger"]: 2688056809,
//     ["System.Runtime.Log"]: 2521294799,
//     ["System.Runtime.Notify"]: 1634664853,
//     ["System.Runtime.Platform"]: 4143741362,
//     ["System.Storage.AsReadOnly"]: 3921628278,
//     ["System.Storage.Delete"]: 3989133359,
//     ["System.Storage.Find"]: 2595762399,
//     ["System.Storage.Get"]: 837311890,
//     ["System.Storage.GetContext"]: 3462919835,
//     ["System.Storage.GetReadOnlyContext"]: 3798709494,
//     ["System.Storage.Put"]: 2216181734,
// }

// export function isNode(input: Instruction | tsm.Node): input is tsm.Node {
//     return input instanceof tsm.Node;
// }

// export function isInstruction(input: Instruction | tsm.Node): input is Instruction {
//     return !isNode(input);
// }

// export function separateInstructions(
//     items?: ReadonlyArray<Instruction | tsm.Node>
// ): [ReadonlyArray<Instruction>, ReadonlyMap<number, tsm.Node>] {
//     if (!items) return [[], new Map()];

//     const instructions = items.filter(isInstruction);
//     const references = new Map(iterateRefs(instructions));

//     return [instructions, references];

//     function* iterateRefs(instructions: ReadonlyArray<Instruction | tsm.Node>): IterableIterator<[number, tsm.Node]> {
//         if (!items) throw new Error();

//         const length = items.length;
//         for (let i = 0; i < length; i++) {
//             const item = items[i];
//             if (isNode(item)) {
//                 const next = items[i + 1];
//                 if (next && isInstruction(next)) {
//                     const index = instructions.indexOf(next);
//                     if (index >= 0) {
//                         yield [index, item];
//                     }
//                 }
//             }
//         }
//     }
// }

// function readInt(ins: Instruction): bigint {
//     if (OpCode.PUSHM1 <= ins.opCode && ins.opCode <= OpCode.PUSH16) {
//         return BigInt(ins.opCode - OpCode.PUSH0);
//     }

//     if (OpCode.PUSHINT8 <= ins.opCode && ins.opCode <= OpCode.PUSHINT256) {
//         return byteArrayToBigInt(ins.operand!);
//     }

//     throw new Error(`invalid integer opcode ${printOpCode(ins.opCode)}`);
// }

// export class OperationBuilder {

//     private localCount: number = 0;
//     private readonly _instructions = new Array<Instruction | tsm.Node>();
//     private readonly _returnTarget: JumpTarget = { instruction: undefined }

//     constructor(readonly paramCount: number = 0) { }

//     get returnTarget(): Readonly<JumpTarget> { return this._returnTarget; }

//     compile() {
//         const instructions = [...this._instructions];

//         if (this.localCount > 0 || this.paramCount > 0) {
//             instructions.unshift({
//                 opCode: OpCode.INITSLOT,
//                 operand: Uint8Array.from([this.localCount, this.paramCount])
//             });
//         }

//         for (const ins of this._instructions) {
//             if (isInstruction(ins)) {
//                 if (isJumpInstruction(ins)) {
//                     validateTarget(ins.target);
//                 }
//                 if (isTryInstruction(ins)) {
//                     validateTarget(ins.catchTarget);
//                     validateTarget(ins.finallyTarget);
//                 }
//             }
//         }

//         return instructions;

//         function validateTarget(target: JumpTarget) {
//             if (!target.instruction) throw new Error("missing target instruction");
//             if (!instructions.includes(target.instruction)) throw new Error("invalid target instruction");
//         }
//     }


//     addLocalSlot() { return this.localCount++; }



//     pushConvert(type: StackItemType) {
//         const opCode = OpCode.CONVERT;
//         const operand = Uint8Array.from([type]);
//         return this.push({ opCode, operand });
//     }






export class OperationBuilder {
    private _localCount: number = 0;
    private readonly _instructions = new Array<Instruction | tsm.Node>();
    private readonly _returnTarget: TargetOffset = { instruction: undefined }

    constructor(readonly paramCount: number) {}

    get returnTarget(): Readonly<TargetOffset> { return this._returnTarget; }

    addLocalSlot() { return this._localCount++; }

    *getInstructions() {
        if (this.paramCount > 0 || this._localCount > 0) {
            const ins: InitSlotInstruction = {
                kind: InstructionKind.INITSLOT,
                localCount: this._localCount,
                paramCount: this.paramCount,
            }
            yield ins;
        }

        yield *this._instructions;
    }

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

    push(ins: Instruction | InstructionKind): NodeSetterWithInstruction {
        if (typeof ins !== 'object') {
            if (specializedInstructionKinds.includes(ins)) {
                throw new Error(`Invalid ${InstructionKind[ins]} instruction`)
            }
            ins = { kind: ins };
        }
        const index = this._instructions.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) {
                    this._instructions.splice(index, 0, node);
                }
            }
        }
    }

    pushBool(value: boolean) {
        const ins: PushBoolInstruction = { kind: InstructionKind.PUSHBOOL, value };
        return this.push(ins);
    }

    pushConvert(type: StackItemType) {
        const ins: ConvertInstruction = { kind: InstructionKind.CONVERT, type };
        return this.push(ins);
    }

    pushInt(value: number | bigint) {
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) throw new Error(`invalid non-integer number ${value}`);
            value = BigInt(value);
        }

        const ins: PushIntInstruction = { kind: InstructionKind.PUSHINT, value };
        return this.push(ins);
    }

    pushData(value: string | Uint8Array) {
        if (typeof value === 'string') {
            value = Buffer.from(value, 'utf8');
        }
        const ins: PushDataInstruction = { kind: InstructionKind.PUSHDATA, value };
        return this.push(ins);
    }

    pushJump(kind: JumpInstructionKind, target: TargetOffset) {
        const ins: JumpInstruction = { kind, target };
        return this.push(ins);
    }

    pushLoad(slot: SlotType, index: number) {
        const kind = slot === 'local'
            ? InstructionKind.LDLOC
            : slot === 'parameter'
                ? InstructionKind.LDARG
                : InstructionKind.LDSFLD;
        const ins: LoadStoreInstruction = { kind, index };
        return this.push(ins);
    }

    pushStore(slot: SlotType, index: number) {
        const kind = slot === 'local'
            ? InstructionKind.STLOC
            : slot === 'parameter'
                ? InstructionKind.STARG
                : InstructionKind.STSFLD;
        const ins: LoadStoreInstruction = { kind, index };
        return this.push(ins);
    }

    pushReturn() {
        if (this._returnTarget.instruction) { throw new Error("returnTarget already set"); }
        this._returnTarget.instruction = this.push(InstructionKind.RET).instruction;
    }

    pushSysCall(service: NeoService) {
        const ins: SysCallInstruction = { kind: InstructionKind.SYSCALL, service };
        return this.push(ins);
    }
}
