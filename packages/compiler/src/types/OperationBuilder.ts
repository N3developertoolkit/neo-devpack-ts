import * as tsm from "ts-morph";
import { Immutable } from "../utility/Immutable";
import { bigIntToByteArray } from "../utils";
import { OperationInfo } from "./CompileContext";
import { CallInstruction, Instruction, JumpInstruction, JumpTarget, NeoService } from "./Instruction";
import { JumpOpCode, OpCode } from "./OpCode";
import { StackItemType } from "./StackItem";

export interface NodeSetter {
    set(node?: tsm.Node): void;
}

type NodeSetterWithInstruction = NodeSetter & { readonly instruction: Instruction };

export const enum SlotType {
    Local,
    Parameter,
    Static
}

const pushIntSizes = [1, 2, 4, 8, 16, 32] as const;

export const sysCallHash: Record<NeoService, number> = {
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

export function isNode(input: Instruction | tsm.Node): input is tsm.Node {
    return input instanceof tsm.Node;
}

export function isInstruction(input: Instruction | tsm.Node): input is Instruction {
    return !isNode(input);
}

export function separateInstructions(
    items?: ReadonlyArray<Instruction | tsm.Node>
): [ReadonlyArray<Instruction>, ReadonlyMap<number, tsm.Node>] {
    if (!items) return [[], new Map()];

    const instructions = items.filter(isInstruction);
    const references = new Map(iterateRefs(instructions));

    return [instructions, references];

    function* iterateRefs(instructions: ReadonlyArray<Instruction | tsm.Node>): IterableIterator<[number, tsm.Node]> {
        if (!items) throw new Error();

        const length = items.length;
        for (let i = 0; i < length; i++) {
            const item = items[i];
            if (isNode(item)) {
                const next = items[i + 1];
                if (next && isInstruction(next)) {
                    const index = instructions.indexOf(next);
                    if (index >= 0) {
                        yield [index, item];
                    }
                }
            }
        }
    }
}

export class OperationBuilder {

    private localCount: number = 0;
    private readonly _instructions = new Array<Instruction | tsm.Node>();
    private readonly _targets = new Set<JumpTarget>();

    constructor(readonly paramCount: number = 0) { }

    compile() {
        const instructions = [...this._instructions];

        if (this.localCount > 0 || this.paramCount > 0) {
            instructions.unshift({
                opCode: OpCode.INITSLOT,
                operand: Uint8Array.from([this.localCount, this.paramCount])
            });
        }

        for (const target of this._targets) {
            if (!target.instruction) throw new Error();
            if (!instructions.includes(target.instruction)) throw new Error();
        }

        return instructions;
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

    push(instruction: Instruction): NodeSetterWithInstruction;
    push(opCode: OpCode): NodeSetterWithInstruction;
    push(arg1: Instruction | OpCode): NodeSetterWithInstruction {
        const ins = typeof arg1 === 'object'
            ? arg1 : { opCode: arg1 };
        const index = this._instructions.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) { this._instructions.splice(index, 0, node); }
            }
        }
    }

    pushCall(operation: Immutable<OperationInfo>) {
        const ins: CallInstruction = {
            opCode: OpCode.CALL_L,
            operation
        };
        return this.push(ins);
    }

    pushConvert(type: StackItemType) {
        const opCode = OpCode.CONVERT;
        const operand = Uint8Array.from([type]);
        return this.push({ opCode, operand });
    }

    pushData(data: string | Uint8Array) {
        if (typeof data === 'string') {
            data = Buffer.from(data, 'utf-8');
        }
        if (data.length <= 255) /* byte.MaxValue */ {
            const opCode = OpCode.PUSHDATA1;
            const operand = Uint8Array.from([data.length, ...data]);
            return this.push({ opCode, operand });
        }
        if (data.length <= 65535) /* ushort.MaxValue */ {
            const opCode = OpCode.PUSHDATA2;
            const length = Buffer.alloc(2);
            length.writeUint16LE(data.length);
            const operand = Uint8Array.from([...length, ...data]);
            return this.push({ opCode, operand });
        }
        if (data.length <= 4294967295) /* uint.MaxValue */ {
            const opCode = OpCode.PUSHDATA4;
            const length = Buffer.alloc(4);
            length.writeUint32LE(data.length);
            const operand = Uint8Array.from([...length, ...data]);
            return this.push({ opCode, operand });
        }
        throw new Error(`pushData length ${data.length} too long`);
    }

    pushInt(value: number | bigint) {
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) throw new Error(`invalid non-integer number ${value}`);
            value = BigInt(value);
        }

        if (value === -1n) {
            return this.push(OpCode.PUSHM1);
        }

        if (value >= 0n && value <= 16n) {
            const opCode: OpCode = OpCode.PUSH0 + Number(value);
            return this.push(opCode);
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
                return this.push({ opCode, operand });
            }
        }

        throw new Error(`pushInt buffer length ${buffer.length} too long`)
    }

    pushJump(target: JumpTarget): NodeSetterWithInstruction;
    pushJump(opCode: JumpOpCode, target: JumpTarget): NodeSetterWithInstruction;
    pushJump(...args:
        [target: JumpTarget] |
        [opCode: JumpOpCode, target: JumpTarget]
    ): NodeSetterWithInstruction {
        const [opCode, target] = args.length === 1
            ? [OpCode.JMP_L as JumpOpCode, args[0]]
            : args;
        this._targets.add(target);
        const ins: JumpInstruction = {
            opCode,
            target
        };
        return this.push(ins);
    }

    pushLoad(slotType: SlotType, index: number) {
        let opCode = slotType === SlotType.Parameter
            ? OpCode.LDARG0
            : slotType === SlotType.Local
                ? OpCode.LDLOC0
                : OpCode.LDSFLD0;
        return this.pushLoadStoreHelper(opCode, index);
    }

    pushStore(slotType: SlotType, index: number) {
        let opCode = slotType === SlotType.Parameter
            ? OpCode.STARG0
            : slotType === SlotType.Local
                ? OpCode.STLOC0
                : OpCode.STSFLD0;
        return this.pushLoadStoreHelper(opCode, index);
    }

    pushSysCall(sysCall: NeoService) {
        const opCode = OpCode.SYSCALL;
        const hash = sysCallHash[sysCall];
        const operand = Buffer.alloc(4);
        operand.writeUInt32LE(hash);
        return this.push({ opCode, operand });
    }

    private pushLoadStoreHelper(opCode: OpCode, index: number) {
        if (index < 0) throw new Error(`Invalid negative slot index ${index}`);
        if (index <= 6) { return this.push(opCode + index); }
        const operand = Uint8Array.from([index]);
        return this.push({ opCode: opCode + 7, operand });
    }
}
