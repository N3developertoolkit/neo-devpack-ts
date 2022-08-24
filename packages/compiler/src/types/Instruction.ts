import { FunctionSymbolDefinition } from "../symbolTable";
import { getAnnotation, isJumpOpCode, isTryOpCode, JumpOpCode, OpCode, toString as opCodeToString, TryOpCode, } from "./OpCode";

export interface Instruction {
    readonly opCode: OpCode,
    readonly operand?: Uint8Array,
}

export function getPrefix(operandSizePrefix: number, operand: Uint8Array): number {
    const buffer = Buffer.from(operand.slice(0, operandSizePrefix));
    switch (operandSizePrefix) {
        case 1: return buffer[0];
        case 2: return buffer.readUInt16LE();
        case 4: return buffer.readUInt32LE();
        default: throw new Error(`Unexpected operandSizePrefix ${operandSizePrefix}`);
    }
}

export function getSize(ins: Instruction): number {
    const annotation = getAnnotation(ins.opCode);
    if (annotation?.operandSize) {
        return annotation.operandSize + 1;
    } else if (annotation?.operandSizePrefix) {
        if (!ins.operand) { 
            throw new Error(`Invalid operand for ${opCodeToString(ins.opCode)}`); 
        }
        return 1 + ins.operand.length;
    } else {
        return 1;
    }
}

export interface JumpTarget {
    instruction: Instruction | undefined
}

export interface JumpInstruction extends Instruction {
    readonly opCode: JumpOpCode,
    readonly target: JumpTarget,
}

export function isJumpInstruction(ins: Instruction): ins is JumpInstruction { 
    return isJumpOpCode(ins.opCode) && 'target' in ins;
}

export interface CallInstruction extends Instruction {
    readonly opCode: OpCode.CALL | OpCode.CALL_L,
    readonly operation: FunctionSymbolDefinition, 
}

export function isCallInstruction(ins: Instruction): ins is CallInstruction {
    return ins.opCode == OpCode.CALL || ins.opCode == OpCode.CALL_L;
}

export interface TryInstruction extends Instruction {
    readonly opCode: TryOpCode,
    readonly catchTarget: JumpTarget,
    readonly finallyTarget: JumpTarget,
}

export function isTryInstruction(ins: Instruction): ins is TryInstruction {
    return isTryOpCode(ins.opCode) && 'catchTarget' in ins && 'finallyTarget' in ins;
}

// List of services generated via this C# code:
//      var services = ApplicationEngine.Services.Values.OrderBy(d => d.Name);
//      foreach (var value in services) {
//          Console.WriteLine($"\"{value.Name}\", ");
//      }
export const neoServices = [
    "System.Contract.Call",
    "System.Contract.CallNative",
    "System.Contract.CreateMultisigAccount",
    "System.Contract.CreateStandardAccount",
    "System.Contract.GetCallFlags",
    "System.Contract.NativeOnPersist",
    "System.Contract.NativePostPersist",
    "System.Crypto.CheckMultisig",
    "System.Crypto.CheckSig",
    "System.Iterator.Next",
    "System.Iterator.Value",
    "System.Runtime.BurnGas",
    "System.Runtime.CheckWitness",
    "System.Runtime.GasLeft",
    "System.Runtime.GetAddressVersion",
    "System.Runtime.GetCallingScriptHash",
    "System.Runtime.GetEntryScriptHash",
    "System.Runtime.GetExecutingScriptHash",
    "System.Runtime.GetInvocationCounter",
    "System.Runtime.GetNetwork",
    "System.Runtime.GetNotifications",
    "System.Runtime.GetRandom",
    "System.Runtime.GetScriptContainer",
    "System.Runtime.GetTime",
    "System.Runtime.GetTrigger",
    "System.Runtime.Log",
    "System.Runtime.Notify",
    "System.Runtime.Platform",
    "System.Storage.AsReadOnly",
    "System.Storage.Delete",
    "System.Storage.Find",
    "System.Storage.Get",
    "System.Storage.GetContext",
    "System.Storage.GetReadOnlyContext",
    "System.Storage.Put",
] as const;

// https://melvingeorge.me/blog/convert-array-into-string-literal-union-type-typescript
export type NeoService = typeof neoServices[number];