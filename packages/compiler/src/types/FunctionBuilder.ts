import * as tsm from "ts-morph";
import { ConvertOperation, InitSlotOperation, Operation, OperationKind, JumpOperation, JumpOperationKind, LoadStoreOperation, PushDataOperation, PushIntOperation, specializedOperationKinds, SysCallOperation, isJumpOperation } from "./Operation";
import { sc } from '@cityofzion/neon-core'

export interface TargetOffset {
    operation: Operation | undefined
}

export interface NodeSetter {
    set(node?: tsm.Node): void;
}

type NodeSetterWithInstruction = NodeSetter & { readonly instruction: Operation };

export type SlotType = 'local' | 'static' | 'parameter';

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







export function isNode(input: Operation | tsm.Node): input is tsm.Node {
    return input instanceof tsm.Node;
}

export function isOperation(input: Operation | tsm.Node): input is Operation {
    return !isNode(input);
}

export class FunctionBuilder {
    private _localCount: number = 0;
    private readonly _operations = new Array<Operation | tsm.Node>();
    private readonly _returnTarget: TargetOffset = { operation: undefined }
    private readonly _jumps = new Map<JumpOperation, TargetOffset>();

    constructor(readonly paramCount: number) {}

    get returnTarget(): Readonly<TargetOffset> { return this._returnTarget; }

    addLocalSlot() { return this._localCount++; }

    get operations(): IterableIterator<Operation | tsm.Node> { return this.getOperations(); }
    private *getOperations() {
        if (this.paramCount > 0 || this._localCount > 0) {
            const ins: InitSlotOperation = {
                kind: OperationKind.INITSLOT,
                localCount: this._localCount,
                paramCount: this.paramCount,
            }
            yield ins;
        }

        const length = this._operations.length;
        for (let i = 0; i < length; i++) {
            const op = this._operations[i];
            if (isOperation(op) && isJumpOperation(op)) {
                const kind = op.kind;
                let offset = 0;
                const target = this._jumps.get(op);
                if (target && target.operation) {
                    const index = this._operations.indexOf(target.operation);
                    if (index >= 0) {
                        offset = index - i;
                    }
                }
                yield { kind, offset};
            } else {
                yield op;
            }
        }
    }

    getNodeSetter(): NodeSetter {
        const length = this._operations.length;
        return {
            set: (node?) => {
                if (node && length < this._operations.length) {
                    this._operations.splice(length, 0, node);
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
        const index = this._operations.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) {
                    this._operations.splice(index, 0, node);
                }
            }
        }
    }

    pushConvert(type: sc.StackItemType) {
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
        const ins: JumpOperation = { kind, offset: 0 };
        this._jumps.set(ins, target);
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
        if (this._returnTarget.operation) { throw new Error("returnTarget already set"); }
        this._returnTarget.operation = this.push(OperationKind.RET).instruction;
    }

    pushSysCall(service: sc.InteropServiceCode) {
        const ins: SysCallOperation = { kind: OperationKind.SYSCALL, service };
        return this.push(ins);
    }
}
