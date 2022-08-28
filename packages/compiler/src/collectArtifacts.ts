import * as tsm from "ts-morph";
import { CompileContext, CompileError, FunctionContext } from "./compiler";
import { ConvertOperation, InitSlotOperation, isJumpOperation, isTryOperation, LoadStoreOperation, Operation, OperationKind, PushDataOperation, PushIntOperation, SysCallOperation } from "./types";
import { bigIntToByteArray, isBigIntLike, isBooleanLike, isNumberLike, isStringLike, isVoidLike } from "./utils";
import { sc } from '@cityofzion/neon-core'

interface Instruction {
    readonly address: number
    readonly opCode: sc.OpCode;
    readonly operand?: Uint8Array;
    readonly location?: tsm.Node;
}

interface OffsetInstruction extends Instruction {
    readonly offset1: number;
    readonly offset2?: number;
}

function isOffsetInstruction(ins: Instruction): ins is OffsetInstruction {
    return 'offset1' in ins;
}

const pushIntSizes = [1, 2, 4, 8, 16, 32] as const;

function convertOperation(operation: Operation, address: number): Instruction {
    function makeInstruction(opCode: sc.OpCode, operand?: Uint8Array): Instruction {
        return { address, opCode, operand, location: operation.location };
    }

    if (isJumpOperation(operation)) {
        const ins: OffsetInstruction = {
            address,
            opCode: <sc.OpCode>(operation.kind + 1),
            operand: new Uint8Array(4),
            location: operation.location,
            offset1: operation.offset,
        }
        return ins;
    }

    if (isTryOperation(operation)) {
        const ins: OffsetInstruction = {
            address,
            opCode: <sc.OpCode>(operation.kind + 1),
            operand: new Uint8Array(8),
            location: operation.location,
            offset1: operation.catchOffset,
            offset2: operation.finallyOffset,
        }
        return ins;
    }

    switch (operation.kind) {
        case OperationKind.CONVERT: {
            const { type } = operation as ConvertOperation;
            const operand = Uint8Array.from([type]);
            return makeInstruction(sc.OpCode.CONVERT, operand);
        }
        case OperationKind.INITSLOT: {
            const { localCount, paramCount } = operation as InitSlotOperation;
            const operand = Uint8Array.from([localCount, paramCount])
            return makeInstruction(sc.OpCode.INITSLOT, operand);
        }
        case OperationKind.PUSHDATA: {
            const { value } = operation as PushDataOperation;

            if (value.length <= 255) /* byte.MaxValue */ {
                const operand = Uint8Array.from([value.length, ...value]);
                return makeInstruction(sc.OpCode.PUSHDATA1, operand);
            }
            if (value.length <= 65535) /* ushort.MaxValue */ {
                const buffer = new ArrayBuffer(2 + value.length);
                new DataView(buffer).setUint16(0, value.length, true);
                const operand = new Uint8Array(buffer);
                operand.set(value, 2);
                return makeInstruction(sc.OpCode.PUSHDATA2, operand);
            }
            if (value.length <= 4294967295) /* uint.MaxValue */ {
                const buffer = new ArrayBuffer(4 + value.length);
                new DataView(buffer).setUint32(0, value.length, true);
                const operand = new Uint8Array(buffer);
                operand.set(value, 4);
                return makeInstruction(sc.OpCode.PUSHDATA4, operand);
            }
            throw new Error(`pushData length ${value.length} too long`);
        }
        case OperationKind.PUSHINT: {
            const { value } = operation as PushIntOperation;
            if (-1n <= value && value <= 16n) {
                const opCode: sc.OpCode = sc.OpCode.PUSH0 + Number(value);
                return makeInstruction(opCode);
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
                    return makeInstruction(opCode, operand);
                }
            }

            throw new Error("convert PUSHINT failed");
        }
        case OperationKind.SYSCALL: {
            const { service } = operation as SysCallOperation;
            const operand = Buffer.from(service, 'hex');
            return makeInstruction(sc.OpCode.SYSCALL, operand);
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
                return makeInstruction(opCode + index);
            }
            const operand = Uint8Array.from([index]);
            return makeInstruction(opCode + 7, operand);
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
        default:
            return makeInstruction(<sc.OpCode>(operation.kind as number));
    }
}

export function collectArtifacts(context: CompileContext) {
    let address = 0;
    let methods = new Map<FunctionContext, number>();
    let instructions = new Array<Instruction>();
    for (const func of context.functions) {
        if (!func.operations) continue;
        methods.set(func, address);
        for (const op of func.operations) {
            const ins = convertOperation(op, address);
            instructions.push(ins);
            address += 1 + (ins.operand?.length ?? 0);
        }
    }

    instructions.forEach((ins, index) => {
        if (isOffsetInstruction(ins)) {
            const dataview = new DataView(ins.operand!.buffer);
            const target1 = instructions[index + ins.offset1]
            const offset1 = target1.address - ins.address;
            dataview.setInt32(0, offset1, true);
            if (ins.offset2) {
                const target2 = instructions[index + ins.offset2]
                const offset2 = target2.address - ins.address;
                dataview.setInt32(4, offset2, true);
            }
        }
    })

    const script = new Array<number>();
    for (const ins of instructions) {
        if (script.length !== ins.address) throw new Error("Invalid instruction")
        const bytes = ins.operand ? [ins.opCode, ...ins.operand] : [ins.opCode];
        script.push(...bytes);
    }

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(script).toString("hex"),
    })

    const methodDefs = new Array<sc.ContractMethodDefinition>();
    for (const [ctx, offset] of methods) {
        const methodDef = toContractMethodDefinition(ctx.node, offset);
        if (methodDef) methodDefs.push(methodDef);
    }

    const manifest = new sc.ContractManifest({
        name: "test-contract",
        abi: new sc.ContractAbi({ methods: methodDefs })
    });

    return { nef, manifest };
}

function toContractMethodDefinition(node: tsm.FunctionDeclaration, offset: number): sc.ContractMethodDefinition | undefined {
    if (!node.hasExportKeyword()) return undefined;
    const returnType = node.getReturnType();
    return new sc.ContractMethodDefinition({
        name: node.getNameOrThrow(),
        offset,
        parameters: node.getParameters().map(p => ({
            name: p.getName(),
            type: convertContractType(p.getType())
        })),
        returnType: isVoidLike(returnType)
            ? sc.ContractParamType.Void
            : convertContractType(returnType)
    });

}

function convertContractType(type: tsm.Type): sc.ContractParamType {
    if (isStringLike(type)) return sc.ContractParamType.String;
    if (isBigIntLike(type) || isNumberLike(type)) return sc.ContractParamType.Integer;
    if (isBooleanLike(type)) return sc.ContractParamType.Boolean;
    throw new Error(`not supported ${type.getText()}`);
}