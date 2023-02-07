import { sc } from "@cityofzion/neon-core";
import { getScriptHashFromPublicKey } from "@cityofzion/neon-core/lib/wallet";

import * as tsm from "ts-morph";
import { CompileContext } from "./compiler";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import { InitSlotOperation, JumpOperation, LoadStoreOperation, Operation, PushDataOperation, SysCallOperation } from "./types/Operation";

function convertPushData({value}: PushDataOperation) {
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

function getOperationSize(op:Operation) {
    switch (op.kind) {
        case 'initslot': 
            return 3;
        case 'syscall':
        case 'jump': 
            return 5;
        case 'storelocal':
        case 'loadlocal': {
            const { index } = op as LoadStoreOperation
            return index <= 6 ? 1 : 2;
        }
        case 'pushdata': {
            const {value} = op as PushDataOperation;
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

function createAddressMap(method: ContractMethod) {
    const addressMap = new Map<number, number>();
    let address = 0;
    method.operations.forEach((v, i) => {
        addressMap.set(i, address);
        address += getOperationSize(v);
    })
    return addressMap;
}

function convertContractMethod(method: ContractMethod, diagnostics: tsm.ts.Diagnostic[]) {

    const addressMap = createAddressMap(method);

    const instructions = new Array<number>();
    method.operations.forEach((op, i) => {
        switch (op.kind) {
            case 'initslot': {
                const {locals, params} = op as InitSlotOperation;
                instructions.push(sc.OpCode.INITSLOT, locals, params);
                break;
            }
            case 'jump': {
                const { offset } = op as JumpOperation;
                const currentAddress = addressMap.get(i);
                const targetAddress = addressMap.get(i + offset);
                if (!currentAddress || !targetAddress) throw new Error();
                const addressOffset = targetAddress - currentAddress;

                const buffer = new ArrayBuffer(4);
                new DataView(buffer).setInt32(0, addressOffset, true);
                instructions.push(sc.OpCode.JMP_L, ...new Uint8Array(buffer));
                break;
            }
            case 'loadlocal': {
                const { index } = op as LoadStoreOperation
                if (index <= 6) instructions.push(sc.OpCode.LDLOC0 + index)
                else instructions.push(sc.OpCode.LDLOC, index); 
                break;
            }
            case 'noop':
                instructions.push(sc.OpCode.NOP);
                break;
            case 'pushdata': 
                instructions.push(...convertPushData(op as PushDataOperation));
                break;
            case 'return':
                instructions.push(sc.OpCode.RET);
            case 'storelocal': {
                const { index } = op as LoadStoreOperation
                if (index <= 6) instructions.push(sc.OpCode.STLOC0 + index)
                else instructions.push(sc.OpCode.STLOC, index); 
                break;
            }
            case 'syscall':{
                const { name } = op as SysCallOperation;
                const code = Buffer.from(sc.generateInteropServiceCode(name), 'hex');
                instructions.push(sc.OpCode.SYSCALL, ...code);
                break;
            }
            default:
                throw new Error(`convertContractMethod ${method.name} ${op.kind}`);
        }
    });
    return Uint8Array.from(instructions);
}

export function processContractMethods(context: CompileContext) {
    const { diagnostics } = context;
    for (const method of context.methods) {
        method.instructions = convertContractMethod(method, diagnostics);
    }
}
