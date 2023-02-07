import { sc } from "@cityofzion/neon-core";
import { range } from "ix/asynciterable";
import { from } from "ix/iterable";
import { map } from "ix/iterable/operators";

import * as tsm from "ts-morph";
import { CompileContext } from "./compiler";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import { SequencePointLocation } from "./types/DebugInfo";
import { InitSlotOperation, JumpOperation, LoadStoreOperation, Operation, PushDataOperation, SysCallOperation } from "./types/Operation";

function convertPushData({ value }: PushDataOperation) {
    if (value.length <= 255) /* byte.MaxValue */ {
        return [sc.OpCode.PUSHDATA1, value.length, ...value];
    }
    if (value.length <= 65535) /* ushort.MaxValue */ {
        const buffer = new ArrayBuffer(2);
        new DataView(buffer).setUint16(0, value.length, true);
        return [sc.OpCode.PUSHDATA2, ...new Uint8Array(buffer), ...value];
    }
    if (value.length <= 4294967295) /* uint.MaxValue */ {
        const buffer = new ArrayBuffer(4);
        new DataView(buffer).setUint32(0, value.length, true);
        return [sc.OpCode.PUSHDATA4, ...new Uint8Array(buffer), ...value];
    }
    throw new Error(`pushData length ${value.length} too long`);
}

function convertLoadStore(opCode: sc.OpCode, { index }: LoadStoreOperation) {
    return (index <= 6) ? [opCode + index] : [opCode + 7, index];
}

function convertSysCall({ name }: SysCallOperation) {
    const code = Buffer.from(sc.generateInteropServiceCode(name), 'hex');
    return [sc.OpCode.SYSCALL, ...code];
}

function convertInitSlot({ locals, params }: InitSlotOperation) {
    return [sc.OpCode.INITSLOT, locals, params];
}

function convertJump(index: number, { offset }: JumpOperation, addressMap: Map<number, number>) {
    const currentAddress = addressMap.get(index);
    const targetAddress = addressMap.get(index + offset);

    if (!currentAddress) throw new Error("could not resolve jump instruction current address")
    if (!targetAddress) throw new Error("could not resolve jump instruction target address")

    const addressOffset = targetAddress - currentAddress;
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setInt32(0, addressOffset, true);
    return [sc.OpCode.JMP_L, ...new Uint8Array(buffer)];
}

export function getOperationSize(op: Operation) {
    switch (op.kind) {
        case 'initslot':
            return 3;
        case 'syscall':
        case 'jump':
            return 5;
        case 'loadarg':
        case 'loadlocal':
        case 'loadstatic':
        case 'storearg':
        case 'storelocal':
        case 'storestatic': {
            const { index } = op as LoadStoreOperation
            return index <= 6 ? 1 : 2;
        }
        case 'pushdata': {
            const { value } = op as PushDataOperation;
            if (value.length <= 255) /* byte.MaxValue */ {
                return 2 + value.length;
            }
            if (value.length <= 65535) /* ushort.MaxValue */ {
                return 3 + value.length;
            }
            if (value.length <= 4294967295) /* uint.MaxValue */ {
                return 5 + value.length;
            }
            throw new Error(`pushData length ${value.length} too long`);
        }
        default:
            return 1;
    }
}

function createAddressMap(operations: ReadonlyArray<Operation>, offset: number) {
    let address = offset;
    const addressMap = new Map<number, number>();
    operations.forEach((v, i) => {
        addressMap.set(i, address);
        address += getOperationSize(v);
    })
    return addressMap;
}

export function compileMethodScript(method: ContractMethod, offset: number, diagnostics: tsm.ts.Diagnostic[]) {

    const addressMap = createAddressMap(method.operations, offset);
    const sequencePoints = new Array<SequencePointLocation>()
    const instructions = new Array<number>();
    let rangeEnd = 0;
    method.operations.forEach((op, i) => {
        rangeEnd = instructions.length;

        if (op.location) {
            sequencePoints.push({ address: rangeEnd, location: op.location });
        }

        switch (op.kind) {
            case 'initslot':
                instructions.push(...convertInitSlot(op as InitSlotOperation));
                break;
            case 'jump':
                instructions.push(...convertJump(i, op as JumpOperation, addressMap));
                break;
            case 'loadarg':
                instructions.push(...convertLoadStore(sc.OpCode.LDARG0, op as LoadStoreOperation));
                break;
            case 'loadlocal':
                instructions.push(...convertLoadStore(sc.OpCode.LDLOC0, op as LoadStoreOperation));
                break;
            case 'loadstatic':
                instructions.push(...convertLoadStore(sc.OpCode.LDSFLD0, op as LoadStoreOperation));
                break;
            case 'noop':
                instructions.push(sc.OpCode.NOP);
                break;
            case 'pushdata':
                instructions.push(...convertPushData(op as PushDataOperation));
                break;
            case 'return':
                instructions.push(sc.OpCode.RET);
                break;
            case 'storearg':
                instructions.push(...convertLoadStore(sc.OpCode.STARG0, op as LoadStoreOperation));
                break;
            case 'storelocal':
                instructions.push(...convertLoadStore(sc.OpCode.STLOC0, op as LoadStoreOperation));
                break;
            case 'storestatic':
                instructions.push(...convertLoadStore(sc.OpCode.STSFLD0, op as LoadStoreOperation));
                break;
            case 'syscall':
                instructions.push(...convertSysCall(op as SysCallOperation));
                break;
            default:
                throw new Error(`convertContractMethod ${method.name} ${op.kind}`);
        }
    });
    return {
        instructions: Uint8Array.from(instructions),
        sequencePoints,
        range: {start: offset, end: offset + rangeEnd},
    };
}









