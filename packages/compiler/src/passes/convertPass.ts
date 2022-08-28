import * as tsm from "ts-morph";
import { CompileContext } from "../compiler";
import { FunctionSymbolDef } from "../scope";
import { ConvertOperation, InitSlotOperation, isJumpOperation, isTryOperation, JumpOperation, LoadStoreOperation, NeoService, Operation, OperationKind, PushDataOperation, PushIntOperation, SysCallOperation } from "../types";
import { isNode, isOperation, TargetOffset } from "../types/FunctionBuilder";
import { OpCode } from "../types/OpCode";
import { bigIntToByteArray } from "../utils";

export interface Instruction {
    readonly opCode: OpCode;
    readonly operand?: Uint8Array;
    readonly location?: tsm.Node;
}

const pushIntSizes = [1, 2, 4, 8, 16, 32] as const;

const sysCallHash: Record<NeoService, number> = {
    ["System.Contract.Call"]: 1381727586,
    ["System.Contract.CallNative"]: 1736177434,
    ["System.Contract.CreateMultisigAccount"]: 166277994,
    ["System.Contract.CreateStandardAccount"]: 42441167,
    ["System.Contract.GetCallFlags"]: 2168117909,
    ["System.Contract.NativeOnPersist"]: 2478627630,
    ["System.Contract.NativePostPersist"]: 375234884,
    ["System.Crypto.CheckMultisig"]: 987549854,
    ["System.Crypto.CheckSig"]: 666101590,
    ["System.Iterator.Next"]: 2632779932,
    ["System.Iterator.Value"]: 499078387,
    ["System.Runtime.BurnGas"]: 3163314883,
    ["System.Runtime.CheckWitness"]: 2364286968,
    ["System.Runtime.GasLeft"]: 3470297108,
    ["System.Runtime.GetAddressVersion"]: 3700574540,
    ["System.Runtime.GetCallingScriptHash"]: 1013863225,
    ["System.Runtime.GetEntryScriptHash"]: 954381561,
    ["System.Runtime.GetExecutingScriptHash"]: 1957232347,
    ["System.Runtime.GetInvocationCounter"]: 1125197700,
    ["System.Runtime.GetNetwork"]: 3768646597,
    ["System.Runtime.GetNotifications"]: 4046799655,
    ["System.Runtime.GetRandom"]: 682221163,
    ["System.Runtime.GetScriptContainer"]: 805851437,
    ["System.Runtime.GetTime"]: 59294647,
    ["System.Runtime.GetTrigger"]: 2688056809,
    ["System.Runtime.Log"]: 2521294799,
    ["System.Runtime.Notify"]: 1634664853,
    ["System.Runtime.Platform"]: 4143741362,
    ["System.Storage.AsReadOnly"]: 3921628278,
    ["System.Storage.Delete"]: 3989133359,
    ["System.Storage.Find"]: 2595762399,
    ["System.Storage.Get"]: 837311890,
    ["System.Storage.GetContext"]: 3462919835,
    ["System.Storage.GetReadOnlyContext"]: 3798709494,
    ["System.Storage.Put"]: 2216181734,
}

function convertOperation(operation: Operation): Instruction {
    if (isJumpOperation(operation)) {
        const ins: OffsetInstruction = { 
            opCode: <OpCode>(operation.kind + 1),
            operand: new Uint8Array(4),
            offset1: operation.offset,
        }
        return ins;
    }

    if (isTryOperation(operation)) {
        const ins: OffsetInstruction = { 
            opCode: <OpCode>(operation.kind + 1),
            operand: new Uint8Array(4),
            offset1: operation.catchOffset,
            offset2: operation.finallyOffset,
        }
        return ins;
    }

    switch (operation.kind) {
        case OperationKind.CONVERT: {
            const { type } = operation as ConvertOperation;
            const opCode = OpCode.CONVERT;
            const operand = Uint8Array.from([type]);
            return { opCode, operand };
        }
        case OperationKind.INITSLOT: {
            const { localCount, paramCount } = operation as InitSlotOperation;
            const opCode = OpCode.INITSLOT;
            const operand = Uint8Array.from([localCount, paramCount])
            return { opCode, operand };
        } 
        case OperationKind.PUSHDATA: {
            const { value } = operation as PushDataOperation;

            if (value.length <= 255) /* byte.MaxValue */ {
                const opCode = OpCode.PUSHDATA1;
                const operand = Uint8Array.from([value.length, ...value]);
                return { opCode, operand };
            }
            if (value.length <= 65535) /* ushort.MaxValue */ {
                const opCode = OpCode.PUSHDATA2;
                const buffer = new ArrayBuffer(2 + value.length);
                new DataView(buffer).setUint16(0, value.length, true);
                const operand = new Uint8Array(buffer);
                operand.set(value, 2);
                return { opCode, operand };
            }
            if (value.length <= 4294967295) /* uint.MaxValue */ {
                const opCode = OpCode.PUSHDATA4;
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
                const opCode: OpCode = OpCode.PUSH0 + Number(value);
                return { opCode };
            }

            const buffer = bigIntToByteArray(value);
            const bufferLength = buffer.length;
            const pushIntSizesLength = pushIntSizes.length;
            for (let index = 0; index < pushIntSizesLength; index++) {
                const pushIntSize = pushIntSizes[index];
                if (bufferLength <= pushIntSize) {
                    const padding = pushIntSize - bufferLength;
                    const opCode: OpCode = OpCode.PUSHINT8 + index;
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
            const hash = sysCallHash[service];
            const buffer = new ArrayBuffer(4);
            new DataView(buffer).setUint32(0, hash, true);
            return { 
                opCode: OpCode.SYSCALL,
                operand: new Uint8Array(buffer)
            };
        }
        case OperationKind.LDARG:
        case OperationKind.LDLOC:
        case OperationKind.LDSFLD:
        case OperationKind.STARG:
        case OperationKind.STLOC:
        case OperationKind.STSFLD: {
            const { kind, index } = operation as LoadStoreOperation;
            const opCode = <OpCode>(kind - 7);
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
        default: return { opCode: (operation.kind as number) as OpCode } ;
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
    for (const symbolDef of context.globals.symbolDefs) {

        if (symbolDef instanceof FunctionSymbolDef) {
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
            for (const opOrNode of symbolDef.operations) {
                if (isOperation(opOrNode)) {
                    const ins = convertOperation(opOrNode);
                    addressMap.set(ins, address);
                    address += 1 + (ins.operand?.length ?? 0);
                    passOne.push(ins);
                } else {
                    passOne.push(opOrNode);
                }
            }

            const passTwo = new Array<Instruction>();
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
                        passTwo.push({
                            opCode: insOrNode.opCode,
                            operand: new Uint8Array(buffer),
                            location
                        })
                    } else {
                        passTwo.push({
                            opCode: insOrNode.opCode,
                            operand: insOrNode.operand,
                            location
                        })
                    }
                }

            }



            
    //         const operations = [...symbolDef.operations].filter(isOperation);
    //         const locationMap = new Map(iterateLocations(symbolDef.operations));
    //         const instructions = new Array<Instruction>();

    //         const operationsLength = operations.length;
    //         let address = 0;
    //         for (let i = 0; i < operationsLength; i++) {
    //             function resolveTarget(target: TargetOffset): number {
    //                 if (!target.operation) throw new Error(`Missing target`);
    //                 const value = operations.indexOf(target.operation);
    //                 if (value < 0) throw new Error(`Invalid target`);
    //                 return value - i;
    //             }

    //             const operation = operations[i];
    //             const ins = convertOperation(operation, resolveTarget);
    //             ins.address = address;
    //             ins.location = locationMap.get(operation);
    //             instructions.push(ins)
                
    //             address += (1 + (ins.operand?.length ?? 0));
    //         }

            

    //         for (let i = 0; i < operationsLength; i++) {
    //             const ins = instructions[i];
    //             if (ins.target) {

    //                 ins.target = undefined;
    //             }

    //         }

        }
    }
}

function *iterateLocations(operations: IterableIterator<Operation | tsm.Node>): IterableIterator<[Operation, tsm.Node]>  {
    let node: tsm.Node | undefined = undefined;
    for (const op of operations) {
        if (isNode(op)) {
            node = op;
        } else {
            if (node) {
                yield [op, node];
                node = undefined;
            }
        }
    }
}