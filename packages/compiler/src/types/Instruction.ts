// Note, this list of instruction codes is incomplete
export const enum InstructionCode {
    CONCAT,
    JUMP,
    LOAD,
    NO_OP,
    PUSHDATA,
    PUSHINT,
    RETURN,
    STORE,
    SYSCALL,
}

export interface Instruction {
    readonly opCode: InstructionCode,
}

export interface JumpTarget {
    instruction: Instruction | undefined
}

export interface JumpInstruction extends Instruction {
    readonly opCode: InstructionCode.JUMP,
    readonly target: JumpTarget,
}

export const enum SlotType {
    Local,
    Parameter,
    Static
}

export interface LoadStoreInstruction extends Instruction {
    readonly opCode: InstructionCode.LOAD | InstructionCode.STORE,
    readonly slotType: SlotType,
    readonly index: number,
}

export interface PushDataInstruction extends Instruction {
    readonly opCode: InstructionCode.PUSHDATA,
    readonly data: Uint8Array,
}

export interface PushIntInstruction extends Instruction {
    readonly opCode: InstructionCode.PUSHINT,
    readonly value: bigint,
}

// https://melvingeorge.me/blog/convert-array-into-string-literal-union-type-typescript
export type NeoService = typeof neoServices[number];

export interface SysCallInstruction extends Instruction {
    opCode: InstructionCode.SYSCALL,
    value: NeoService,
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