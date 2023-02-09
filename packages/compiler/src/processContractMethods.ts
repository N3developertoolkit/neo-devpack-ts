import { sc, u } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import { MethodSymbolDef } from "./scope";
import { SequencePointLocation } from "./types/DebugInfo";
import { CallOperation, CallTokenOperation, ConvertOperation, InitSlotOperation, JumpOperation, JumpOperationKind, LoadStoreOperation, Operation, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation } from "./types/Operation";
import { bigIntToByteArray } from "./utils";

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

function convertCall({ method }: CallOperation, currentAddress: number, methodAddresses: ReadonlyMap<MethodSymbolDef, number>) {
    const targetAddress = methodAddresses.get(method);
    if (!targetAddress) throw new Error(`cannot find address for ${method.symbol.getName()}`)
    const addressOffset = targetAddress - currentAddress;

    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return [sc.OpCode.CALL_L, ...new Uint8Array(buffer)];
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
    new DataView(buffer).setInt32(0, addressOffset, true);
    return [opCode, ...new Uint8Array(buffer)];
}

function convertBigInteger(value: bigint) {
    // neon-js BigInteger is not directly compatible with JS bigint type
    // but we can go bigint -> string -> BigInteger to convert
    const $value = u.BigInteger.fromNumber(value.toString());
    const token = sc.OpToken.forInteger($value);
    return {
        opCode: token.code,
        buffer: Buffer.from(token.params!, 'hex')
    };
}

function convertPushInt({ value }: PushIntOperation) {
    if (value <= 16n && value >= -1n) {
        const opCode = sc.OpCode.PUSH0 + Number(value);
        return [opCode]
    }

    const {opCode, buffer} = convertBigInteger(value);
    return [opCode, ...new Uint8Array(buffer)];
}

function getOperationSize(op: Operation) {
    switch (op.kind) {
        case 'add':
        case 'append':
        case 'concat':
        case 'drop':
        case 'duplicate':
        case 'equal':
        case 'greaterthan':
        case 'greaterthanorequal':
        case 'isnull':
        case 'lessthan':
        case 'lessthanorequal':
        case 'multiply':
        case 'negate':
        case 'newemptyarray':
        case 'noop':
        case 'not':
        case 'notequal':
        case 'pickitem':
        case 'pushbool':
        case 'pushnull':
        case 'power':
        case 'return':
        case 'subtract':
        case 'throw':
            return 1;
        case 'convert':
            return 2;
        case 'calltoken':
        case 'initslot':
            return 3;
        case 'call':
        case 'jump':
        case 'jumpif':
        case 'jumpifnot':
        case 'jumpeq':
        case "jumpne":
        case "jumpgt":
        case "jumpge":
        case "jumplt":
        case "jumple":
        case 'syscall':
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

            const {buffer} = convertBigInteger(value);
            return 1 + buffer.length;
        }
        default:
            throw new Error(`getOperationSize ${op.kind}`);
    }
}

export function getMethodSize(method: ContractMethod) {
    let size = 0;
    for (const op of method.operations) {
        size += getOperationSize(op);
    }
    return size;
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

interface MethodCompileOptions {
    diagnostics: tsm.ts.Diagnostic[];
    tokens: ReadonlyArray<sc.MethodToken>;
    methodAddressMap: ReadonlyMap<MethodSymbolDef, number>;
}
export function compileMethodScript(
    method: ContractMethod, 
    offset: number, 
    { diagnostics, tokens, methodAddressMap }: MethodCompileOptions
) {

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
            case 'add':
                instructions.push(sc.OpCode.ADD);
                break;
            case 'append':
                instructions.push(sc.OpCode.APPEND);
                break;
            case 'call':
                instructions.push(...convertCall(op as CallOperation, addressMap.get(i)!, methodAddressMap));
                break;
            case 'calltoken':
                instructions.push(...convertCallToken(op as CallTokenOperation, tokens));
                break;
            case 'concat':
                instructions.push(sc.OpCode.CAT);
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
            case 'equal':
                instructions.push(sc.OpCode.EQUAL);
                break;
            case 'greaterthan':
                instructions.push(sc.OpCode.GT);
                break;
            case 'greaterthanorequal':
                instructions.push(sc.OpCode.GE);
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
            case 'lessthan':
                instructions.push(sc.OpCode.LT);
                break;
            case 'lessthanorequal':
                instructions.push(sc.OpCode.LE);
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
            case 'multiply':
                instructions.push(sc.OpCode.MUL);
                break;
            case 'negate':
                instructions.push(sc.OpCode.NEGATE);
                break;
            case 'newemptyarray':
                instructions.push(sc.OpCode.NEWARRAY0);
                break;
            case 'noop':
                instructions.push(sc.OpCode.NOP);
                break;
            case 'not':
                instructions.push(sc.OpCode.NOT);
                break;
            case 'notequal':
                instructions.push(sc.OpCode.NOTEQUAL);
                break;
            case 'pickitem':
                instructions.push(sc.OpCode.PICKITEM);
                break;
            case 'power':
                instructions.push(sc.OpCode.POW);
                break;
            case 'pushbool': {
                const { value } = op as PushBoolOperation;
                // neon-js hasn't added the PUSHT (0x08) or PUSHF (0x09) opcodes yet
                instructions.push(value ? 0x08 : 0x09);
                break;
            }
            case 'pushdata':
                instructions.push(...convertPushData(op as PushDataOperation));
                break;
            case 'pushint':
                instructions.push(...convertPushInt(op as PushIntOperation));
                break;
            case 'pushnull':
                instructions.push(sc.OpCode.PUSHNULL);
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
            case 'subtract':
                instructions.push(sc.OpCode.SUB)
                break;
                case 'syscall':
                instructions.push(...convertSysCall(op as SysCallOperation));
                break;
            case 'throw':
                instructions.push(sc.OpCode.THROW);
                break;
            default:
                throw new Error(`convertContractMethod ${method.def.node.getName()} ${op.kind}`);
        }
    });
    return {
        instructions: Uint8Array.from(instructions),
        sequencePoints,
        range: { start: offset, end: offset + rangeEnd },
    };
}









