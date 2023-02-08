import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import { SequencePointLocation } from "./types/DebugInfo";
import { CallTokenOperation, ConvertOperation, InitSlotOperation, JumpOperation, JumpOperationKind, LoadStoreOperation, Operation, PushDataOperation, PushIntOperation, SysCallOperation } from "./types/Operation";

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

function convertCallToken({ token }: CallTokenOperation, tokens: ReadonlyArray<sc.MethodToken>) {
    const index = tokens.findIndex(t => t.hash === token.hash && t.method === token.method);
    if (index < 0) throw new Error(`convertCallToken: ${token.hash} ${token.method}`);
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setUint16(0, index, true);
    return [sc.OpCode.CALLT, ...new Uint8Array(buffer)];
}

function convertJumpOperationKind(kind: JumpOperationKind) {
    switch (kind) {
        case "jump": return sc.OpCode.JMP_L;
        case "jumpeq": return sc.OpCode.JMPEQ_L;
        case "jumpge": return sc.OpCode.JMPGE_L;
        case "jumpgt": return sc.OpCode.JMPGT_L;
        case "jumpif": return sc.OpCode.JMPIF_L;
        case "jumpifnot": return sc.OpCode.JMPIFNOT_L;
        case "jumple": return sc.OpCode.JMPLE_L;
        case "jumplt": return sc.OpCode.JMPLT_L;
        case "jumpne": return sc.OpCode.JMPNE_L;
        default: throw new Error(`Invalid JumpOperationKind ${kind}`);
    }
}

function convertJump(index: number, { kind, offset }: JumpOperation, addressMap: Map<number, number>) {
    const opCode = convertJumpOperationKind(kind);
    const currentAddress = addressMap.get(index);
    const targetAddress = addressMap.get(index + offset);

    if (!currentAddress) throw new Error("could not resolve jump instruction current address")
    if (!targetAddress) throw new Error("could not resolve jump instruction target address")

    const addressOffset = targetAddress - currentAddress;
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setInt32(0, addressOffset, true);
    return [opCode, ...new Uint8Array(buffer)];
}

function convertPushInt({ value }: PushIntOperation) {
    if (value <= 16n && value >= -1n) {
        const opCode = sc.OpCode.PUSH0 + Number(value);
        return [opCode]
    }
    throw new Error(`convertPushInt not implemented for ${value}`);
}

export function getOperationSize(op: Operation) {
    switch (op.kind) {
        case 'drop':
        case 'duplicate':
        case 'isnull':
        case 'noop':
        case 'pickitem':
        case 'return':
        case 'throw':
            return 1;
        case 'convert':
            return 2;
        case 'initslot':
        case 'calltoken':
            return 3;
        case 'syscall':
        case 'jump':
        case 'jumpif':
        case 'jumpifnot':
        case 'jumpeq':
        case "jumpne":
        case "jumpgt":
        case "jumpge":
        case "jumplt":
        case "jumple":
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
        case 'pushint': {
            const { value } = op as PushIntOperation;
            if (value <= 16n && value >= -1n) return 1;
            throw new Error(`pushint ${value}`);
        }
        default:
            throw new Error(`getOperationSize ${op.kind}`);
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

export function compileMethodScript(method: ContractMethod, offset: number, tokens: ReadonlyArray<sc.MethodToken>, diagnostics: tsm.ts.Diagnostic[]) {

    const addressMap = createAddressMap(method.operations, offset);
    const sequencePoints = new Array<SequencePointLocation>();
    const instructions = new Array<number>();
    let rangeEnd = 0;
    method.operations.forEach((op, i) => {
        rangeEnd = instructions.length;

        if (op.location) {
            sequencePoints.push({ address: offset + rangeEnd, location: op.location });
        }

        switch (op.kind) {
            case 'calltoken':
                instructions.push(...convertCallToken(op as CallTokenOperation, tokens));
                break;
            case 'convert': {
                const { type } = op as ConvertOperation;
                instructions.push(sc.OpCode.CONVERT, type);
                break;
            }
            case 'drop':
                instructions.push(sc.OpCode.DROP)
                break;
            case 'duplicate':
                instructions.push(sc.OpCode.DUP);
                break;
            case 'initslot': {
                const { locals, params } = op as InitSlotOperation;
                instructions.push(sc.OpCode.INITSLOT, locals, params);
                break;
            }
            case 'isnull':
                instructions.push(sc.OpCode.ISNULL);
                break;
            case 'jump':
            case 'jumpif':
            case 'jumpifnot':
            case 'jumpeq':
            case "jumpne":
            case "jumpgt":
            case "jumpge":
            case "jumplt":
            case "jumple":
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
            case 'pickitem':
                instructions.push(sc.OpCode.PICKITEM);
                break;
            case 'pushdata':
                instructions.push(...convertPushData(op as PushDataOperation));
                break;
            case 'pushint':
                instructions.push(...convertPushInt(op as PushIntOperation));
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
            case 'throw':
                instructions.push(sc.OpCode.THROW);
                break;
            default:
                throw new Error(`convertContractMethod ${method.name} ${op.kind}`);
        }
    });
    return {
        instructions: Uint8Array.from(instructions),
        sequencePoints,
        range: { start: offset, end: offset + rangeEnd },
    };
}









