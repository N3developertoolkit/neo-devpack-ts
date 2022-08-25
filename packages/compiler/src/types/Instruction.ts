// List of services generated via this C# code:
//      var services = ApplicationEngine.Services.Values.OrderBy(d => d.Name);
//      foreach (var value in services) {
//          Console.WriteLine($"\"{value.Name}\", ");

import { StackItemType } from "./StackItem";

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

// Instruction Kind is slightly simplified version of NeoVM OpCode enum
//  * Adds PUSHBOOL opcode
//  * All the PUSHINT* opcodes are folded into a single Instruction Kind
//  * The PUSHDATA? opcodes are folded into a single Instruction Kind
//  * All the opcode pairs with and without an _L variant have been folded into a single Instruction Kind
//  * the hard coded index Load/Store opcodes have been folded into a single Instruction Kind 
export enum InstructionKind {
    PUSHBOOL,
    PUSHINT,
    // PUSHINT8,
    // PUSHINT16, 
    // PUSHINT32, 
    // PUSHINT64, 
    // PUSHINT128,
    // PUSHINT256,
    PUSHA,     
    PUSHNULL,
    PUSHDATA,
    // PUSHDATA1,
    // PUSHDATA2,
    // PUSHDATA4,
    // PUSHM1,
    // PUSH0,
    // PUSH1,
    // PUSH2,
    // PUSH3,
    // PUSH4,
    // PUSH5,
    // PUSH6,
    // PUSH7,
    // PUSH8,
    // PUSH9,
    // PUSH10,
    // PUSH11,
    // PUSH12,
    // PUSH13,
    // PUSH14,
    // PUSH15,
    // PUSH16,
    NOP,
    JMP,
    // JMP_L,
    JMPIF,
    // JMPIF_L,
    JMPIFNOT,
    // JMPIFNOT_L,
    JMPEQ,
    // JMPEQ_L,
    JMPNE,
    // JMPNE_L,
    JMPGT,
    // JMPGT_L,
    JMPGE,
    // JMPGE_L,
    JMPLT,
    // JMPLT_L,
    JMPLE,
    // JMPLE_L,
    CALL,
    // CALL_L,
    CALLA,
    CALLT,
    ABORT,
    ASSERT,
    THROW,
    TRY,
    // TRY_L,
    ENDTRY,
    // ENDTRY_L,
    ENDFINALLY,
    RET,
    SYSCALL,
    DEPTH,
    DROP,
    NIP,
    XDROP,
    CLEAR,
    DUP,
    OVER,
    PICK,
    TUCK,
    SWAP,
    ROT,
    ROLL,
    REVERSE3,
    REVERSE4,
    REVERSEN,
    INITSSLOT,
    INITSLOT,
    // LDSFLD0,
    // LDSFLD1,
    // LDSFLD2,
    // LDSFLD3,
    // LDSFLD4,
    // LDSFLD5,
    // LDSFLD6,
    LDSFLD,
    // STSFLD0,
    // STSFLD1,
    // STSFLD2,
    // STSFLD3,
    // STSFLD4,
    // STSFLD5,
    // STSFLD6,
    STSFLD,
    // LDLOC0,
    // LDLOC1,
    // LDLOC2,
    // LDLOC3,
    // LDLOC4,
    // LDLOC5,
    // LDLOC6,
    LDLOC,
    // STLOC0,
    // STLOC1,
    // STLOC2,
    // STLOC3,
    // STLOC4,
    // STLOC5,
    // STLOC6,
    STLOC,
    // LDARG0,
    // LDARG1,
    // LDARG2,
    // LDARG3,
    // LDARG4,
    // LDARG5,
    // LDARG6,
    LDARG,
    // STARG0,
    // STARG1,
    // STARG2,
    // STARG3,
    // STARG4,
    // STARG5,
    // STARG6,
    STARG,
    NEWBUFFER,
    MEMCPY,
    CAT,
    SUBSTR,
    LEFT,
    RIGHT,
    INVERT,
    AND,
    OR,
    XOR,
    EQUAL,
    NOTEQUAL,
    SIGN,
    ABS,
    NEGATE,
    INC,
    DEC,
    ADD,
    SUB,
    MUL,
    DIV,
    MOD,
    POW,
    SQRT,
    MODMUL,
    MODPOW,
    SHL,
    SHR,
    NOT,
    BOOLAND,
    BOOLOR,
    NZ,
    NUMEQUAL,
    NUMNOTEQUAL,
    LT,
    LE,
    GT,
    GE,
    MIN,
    MAX,
    WITHIN,
    PACKMAP,
    PACKSTRUCT,
    PACK,
    UNPACK,
    NEWARRAY0,
    NEWARRAY,
    NEWARRAY_T,
    NEWSTRUCT0,
    NEWSTRUCT,
    NEWMAP,
    SIZE,
    HASKEY,
    KEYS,
    VALUES,
    PICKITEM,
    APPEND,
    SETITEM,
    REVERSEITEMS,
    REMOVE,
    CLEARITEMS,
    POPITEM,
    ISNULL,
    ISTYPE,
    CONVERT,
}

export interface Instruction {
    readonly kind: InstructionKind
}

export interface ConvertInstruction extends Instruction {
    readonly kind: InstructionKind.CONVERT;
    readonly type: StackItemType
}

export function isConvertInstruction(ins: Instruction): ins is ConvertInstruction {
    return ins.kind === InstructionKind.CONVERT;    
}

export interface InitSlotInstruction extends Instruction {
    readonly kind: InstructionKind.INITSLOT;
    readonly localCount: number,
    readonly paramCount: number,
}

export function isInitSlotInstruction(ins: Instruction): ins is InitSlotInstruction {
    return ins.kind === InstructionKind.INITSLOT;    
}

export interface PushBoolInstruction extends Instruction {
    readonly kind: InstructionKind.PUSHBOOL;
    readonly value: boolean
}

export function isPushBoolInstruction(ins: Instruction): ins is PushBoolInstruction {
    return ins.kind === InstructionKind.PUSHBOOL;
}

export interface PushDataInstruction extends Instruction {
    readonly kind: InstructionKind.PUSHDATA;
    readonly value: Uint8Array
}

export function isPushDataInstruction(ins: Instruction): ins is PushDataInstruction {
    return ins.kind === InstructionKind.PUSHDATA;
}

export interface PushIntInstruction extends Instruction {
    readonly kind: InstructionKind.PUSHINT;
    readonly value: bigint;
}

export function isPushIntInstruction(ins: Instruction): ins is PushIntInstruction {
    return ins.kind === InstructionKind.PUSHINT;
}

export interface SysCallInstruction extends Instruction {
    readonly kind: InstructionKind.SYSCALL,
    readonly service: NeoService
}

export function isSysCallInstruction(ins: Instruction): ins is SysCallInstruction {
    return ins.kind === InstructionKind.SYSCALL;
}

export interface TryInstruction extends Instruction {
    readonly kind: InstructionKind.TRY,
    readonly catchTarget: TargetOffset,
    readonly finallyTarget: TargetOffset,
}

export function isTryInstruction(ins: Instruction): ins is TryInstruction {
    return ins.kind === InstructionKind.TRY;
}


export interface TargetOffset {
    instruction: Instruction | undefined
}

const jumpInstructionKinds = [
    InstructionKind.JMP ,
    InstructionKind.JMPIF ,
    InstructionKind.JMPIFNOT ,
    InstructionKind.JMPEQ ,
    InstructionKind.JMPNE ,
    InstructionKind.JMPGT ,
    InstructionKind.JMPGE ,
    InstructionKind.JMPLT ,
    InstructionKind.JMPLE,
] as const;

export type JumpInstructionKind = typeof jumpInstructionKinds[number];

export interface JumpInstruction extends Instruction {
    readonly kind: JumpInstructionKind;
    readonly target: TargetOffset;
}

export function isJumpInstruction(ins: Instruction): ins is JumpInstruction {
    return (jumpInstructionKinds as ReadonlyArray<InstructionKind>).includes(ins.kind);
}

const loadStoreInstructionKinds = [
    InstructionKind.LDARG,
    InstructionKind.LDLOC,
    InstructionKind.LDSFLD,
    InstructionKind.STARG, 
    InstructionKind.STLOC, 
    InstructionKind.STSFLD,
] as const;

export type LoadStoreInstructionKind = typeof loadStoreInstructionKinds[number];

export interface LoadStoreInstruction extends Instruction {
    readonly kind: LoadStoreInstructionKind
    readonly index: number
}

export function isLoadStoreInstruction(ins: Instruction): ins is LoadStoreInstruction {
    return (loadStoreInstructionKinds as ReadonlyArray<InstructionKind>).includes(ins.kind);
}

export const specializedInstructionKinds: ReadonlyArray<InstructionKind> = [
    InstructionKind.CONVERT,
    InstructionKind.INITSLOT,
    InstructionKind.PUSHBOOL,
    InstructionKind.PUSHDATA,
    InstructionKind.PUSHINT,
    InstructionKind.SYSCALL,
    InstructionKind.TRY,
    ...jumpInstructionKinds, 
    ...loadStoreInstructionKinds];