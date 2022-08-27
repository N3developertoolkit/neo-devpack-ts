import * as tsm from "ts-morph";
// import { FunctionSymbolDefinition } from "../symbolTable";
// import { bigIntToByteArray, byteArrayToBigInt } from "../utils";
// import { CallInstruction, Instruction, isJumpInstruction, isTryInstruction, JumpInstruction, JumpTarget, NeoService } from "./Instruction";
// import { isJumpOpCode, JumpOpCode, OpCode, toString as opCodeToString, toString as printOpCode } from "./OpCode";
// import { StackItemType } from "./StackItem";

import { ConvertOperation, InitSlotOperation, Operation, OperationKind, JumpOperation, JumpOperationKind, LoadStoreOperation, NeoService, PushBoolOperation, PushDataOperation, PushIntOperation, specializedOperationKinds, SysCallOperation, TargetOffset } from "./Operation";
import { StackItemType } from "./StackItem";

export interface NodeSetter {
    set(node?: tsm.Node): void;
}

type NodeSetterWithInstruction = NodeSetter & { readonly instruction: Operation };

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







export class FunctionBuilder {
    private _localCount: number = 0;
    private readonly _instructions = new Array<Operation | tsm.Node>();
    private readonly _returnTarget: TargetOffset = { instruction: undefined }

    constructor(readonly paramCount: number) {}

    get returnTarget(): Readonly<TargetOffset> { return this._returnTarget; }

    addLocalSlot() { return this._localCount++; }

    get instructions(): IterableIterator<Operation | tsm.Node> { return this.getInstructions(); }
    private *getInstructions() {
        if (this.paramCount > 0 || this._localCount > 0) {
            const ins: InitSlotOperation = {
                kind: OperationKind.INITSLOT,
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

    push(ins: Operation | OperationKind): NodeSetterWithInstruction {
        if (typeof ins !== 'object') {
            if (specializedOperationKinds.includes(ins)) {
                throw new Error(`Invalid ${OperationKind[ins]} instruction`)
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
        const ins: PushBoolOperation = { kind: OperationKind.PUSHBOOL, value };
        return this.push(ins);
    }

    pushConvert(type: StackItemType) {
        const ins: ConvertOperation = { kind: OperationKind.CONVERT, type };
        return this.push(ins);
    }

    pushInt(value: number | bigint) {
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) throw new Error(`invalid non-integer number ${value}`);
            value = BigInt(value);
        }

        const ins: PushIntOperation = { kind: OperationKind.PUSHINT, value };
        return this.push(ins);
    }

    pushData(value: string | Uint8Array) {
        if (typeof value === 'string') {
            value = Buffer.from(value, 'utf8');
        }
        const ins: PushDataOperation = { kind: OperationKind.PUSHDATA, value };
        return this.push(ins);
    }

    pushJump(kind: JumpOperationKind, target: TargetOffset) {
        const ins: JumpOperation = { kind, target };
        return this.push(ins);
    }

    pushLoad(slot: SlotType, index: number) {
        const kind = slot === 'local'
            ? OperationKind.LDLOC
            : slot === 'parameter'
                ? OperationKind.LDARG
                : OperationKind.LDSFLD;
        const ins: LoadStoreOperation = { kind, index };
        return this.push(ins);
    }

    pushStore(slot: SlotType, index: number) {
        const kind = slot === 'local'
            ? OperationKind.STLOC
            : slot === 'parameter'
                ? OperationKind.STARG
                : OperationKind.STSFLD;
        const ins: LoadStoreOperation = { kind, index };
        return this.push(ins);
    }

    pushReturn() {
        if (this._returnTarget.instruction) { throw new Error("returnTarget already set"); }
        this._returnTarget.instruction = this.push(OperationKind.RET).instruction;
    }

    pushSysCall(service: NeoService) {
        const ins: SysCallOperation = { kind: OperationKind.SYSCALL, service };
        return this.push(ins);
    }
}
