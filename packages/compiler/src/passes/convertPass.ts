import * as tsm from "ts-morph";
import { CompileContext } from "../compiler";
import { ConvertOperation, InitSlotOperation, isJumpOperation, isTryOperation, LoadStoreOperation, Operation, OperationKind, PushDataOperation, PushIntOperation, SysCallOperation } from "../types";
import { isOperation } from "../types/FunctionBuilder";
import { bigIntToByteArray } from "../utils";
import { sc } from '@cityofzion/neon-core'

export interface Instruction {
    readonly opCode: sc.OpCode;
    readonly operand?: Uint8Array;
    readonly location?: tsm.Node;
}

const pushIntSizes = [1, 2, 4, 8, 16, 32] as const;

function convertOperation(operation: Operation): Instruction {
    if (isJumpOperation(operation)) {
        const ins: OffsetInstruction = {
            opCode: <sc.OpCode>(operation.kind + 1),
            operand: new Uint8Array(4),
            offset1: operation.offset,
        }
        return ins;
    }

    if (isTryOperation(operation)) {
        const ins: OffsetInstruction = {
            opCode: <sc.OpCode>(operation.kind + 1),
            operand: new Uint8Array(4),
            offset1: operation.catchOffset,
            offset2: operation.finallyOffset,
        }
        return ins;
    }

    switch (operation.kind) {
        case OperationKind.CONVERT: {
            const { type } = operation as ConvertOperation;
            const opCode = sc.OpCode.CONVERT;
            const operand = Uint8Array.from([type]);
            return { opCode, operand };
        }
        case OperationKind.INITSLOT: {
            const { localCount, paramCount } = operation as InitSlotOperation;
            const opCode = sc.OpCode.INITSLOT;
            const operand = Uint8Array.from([localCount, paramCount])
            return { opCode, operand };
        }
        case OperationKind.PUSHDATA: {
            const { value } = operation as PushDataOperation;

            if (value.length <= 255) /* byte.MaxValue */ {
                const opCode = sc.OpCode.PUSHDATA1;
                const operand = Uint8Array.from([value.length, ...value]);
                return { opCode, operand };
            }
            if (value.length <= 65535) /* ushort.MaxValue */ {
                const opCode = sc.OpCode.PUSHDATA2;
                const buffer = new ArrayBuffer(2 + value.length);
                new DataView(buffer).setUint16(0, value.length, true);
                const operand = new Uint8Array(buffer);
                operand.set(value, 2);
                return { opCode, operand };
            }
            if (value.length <= 4294967295) /* uint.MaxValue */ {
                const opCode = sc.OpCode.PUSHDATA4;
                const buffer = new ArrayBuffer(4 + value.length);
                new DataView(buffer).setUint32(0, value.length, true);
                const operand = new Uint8Array(buffer);
                operand.set(value, 4);
                return { opCode, operand };
            }
            throw new Error(`pushData length ${value.length} too long`);
        }
        case OperationKind.PUSHINT: {
            const { value } = operation as PushIntOperation;
            if (-1n <= value && value <= 16n) {
                const opCode: sc.OpCode = sc.OpCode.PUSH0 + Number(value);
                return { opCode };
            }

            const buffer = bigIntToByteArray(value);
            const bufferLength = buffer.length;
            const pushIntSizesLength = pushIntSizes.length;
            for (let index = 0; index < pushIntSizesLength; index++) {
                const pushIntSize = pushIntSizes[index];
                if (bufferLength <= pushIntSize) {
                    const padding = pushIntSize - bufferLength;
                    const opCode: sc.OpCode = sc.OpCode.PUSHINT8 + index;
                    const operand = padding == 0
                        ? buffer
                        : Uint8Array.from([
                            ...buffer,
                            ...Buffer.alloc(padding, value < 0 ? 0xff : 0x00)]);
                    return { opCode, operand };
                }
            }

            throw new Error("convert PUSHINT failed");
        }
        case OperationKind.SYSCALL: {
            const { service } = operation as SysCallOperation;
            return {
                opCode: sc.OpCode.SYSCALL,
                operand: Buffer.from(service, 'hex')
            };
        }
        case OperationKind.LDARG:
        case OperationKind.LDLOC:
        case OperationKind.LDSFLD:
        case OperationKind.STARG:
        case OperationKind.STLOC:
        case OperationKind.STSFLD: {
            const { kind, index } = operation as LoadStoreOperation;
            const opCode = <sc.OpCode>(kind - 7);
            if (index <= 6) {
                return { opCode: opCode + index }
            }
            const operand = Uint8Array.from([index]);
            return { opCode: opCode + 7, operand };

        }
        case OperationKind.JMP:
        case OperationKind.JMPIF:
        case OperationKind.JMPIFNOT:
        case OperationKind.JMPEQ:
        case OperationKind.JMPNE:
        case OperationKind.JMPGT:
        case OperationKind.JMPGE:
        case OperationKind.JMPLT:
        case OperationKind.JMPLE:
        case OperationKind.TRY:
            throw new Error("handled before switch");
        default: return { opCode: (operation.kind as number) as sc.OpCode };
    }

}

interface OffsetInstruction extends Instruction {
    offset1: number;
    offset2?: number;
}

function isOffsetInstruction(ins: Instruction): ins is OffsetInstruction {
    return 'offset1' in ins;
}

export function convertPass(context: CompileContext): void {
    for (const func of context.functions) {
        if (!func.operations) continue;

        const passOne = new Array<Instruction | tsm.Node>();
        const addressMap = new Map<Instruction, number>();

        function getOffsetAddress(index: number, offset: number) {
            const sourceAddress = addressMap.get(passOne[index] as Instruction);
            if (!sourceAddress) throw new Error("invalid source")
            const targetAddress = addressMap.get(passOne[index + offset] as Instruction);
            if (!targetAddress) throw new Error("invalid target");
            return targetAddress - sourceAddress;
        }

        let address = 0;
        for (const opOrNode of func.operations) {
            if (isOperation(opOrNode)) {
                const ins = convertOperation(opOrNode);
                addressMap.set(ins, address);
                address += 1 + (ins.operand?.length ?? 0);
                passOne.push(ins);
            } else {
                passOne.push(opOrNode);
            }
        }

        const instructions = new Array<Instruction>();
        let location: tsm.Node | undefined = undefined;
        for (let index = 0; index < passOne.length; index++) {
            const insOrNode = passOne[index];
            if (insOrNode instanceof tsm.Node) {
                location = insOrNode;
            } else {
                if (isOffsetInstruction(insOrNode)) {
                    const offset1 = getOffsetAddress(index, insOrNode.offset1);
                    const offset2 = insOrNode.offset2 ? getOffsetAddress(index, insOrNode.offset2) : undefined;
                    const buffer = new ArrayBuffer(offset2 ? 8 : 4);
                    const dataview = new DataView(buffer);
                    dataview.setInt32(0, offset1, true);
                    if (offset2) { dataview.setInt32(4, offset2, true); }
                    instructions.push({
                        opCode: insOrNode.opCode,
                        operand: new Uint8Array(buffer),
                        location
                    })
                } else {
                    instructions.push({
                        opCode: insOrNode.opCode,
                        operand: insOrNode.operand,
                        location
                    })
                }
            }
        }
        func.instructions = instructions;
    }
}