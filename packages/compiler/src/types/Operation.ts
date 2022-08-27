import { StackItemType } from "./StackItem";

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

// Instruction Kind is slightly simplified version of NeoVM OpCode enum
//  * Adds PUSHBOOL opcode
//  * All the PUSHINT* opcodes are folded into a single Instruction Kind
//  * The PUSHDATA? opcodes are folded into a single Instruction Kind
//  * All the opcode pairs with and without an _L variant have been folded into a single Instruction Kind
//  * the hard coded index Load/Store opcodes have been folded into a single Instruction Kind 
export enum OperationKind {
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

export interface Operation {
    readonly kind: OperationKind
}

export interface ConvertOperation extends Operation {
    readonly kind: OperationKind.CONVERT;
    readonly type: StackItemType
}

export function isConvertOperation(ins: Operation): ins is ConvertOperation {
    return ins.kind === OperationKind.CONVERT;    
}

export interface InitSlotOperation extends Operation {
    readonly kind: OperationKind.INITSLOT;
    readonly localCount: number,
    readonly paramCount: number,
}

export function isInitSlotOperation(ins: Operation): ins is InitSlotOperation {
    return ins.kind === OperationKind.INITSLOT;    
}

export interface PushBoolOperation extends Operation {
    readonly kind: OperationKind.PUSHBOOL;
    readonly value: boolean
}

export function isPushBoolOperation(ins: Operation): ins is PushBoolOperation {
    return ins.kind === OperationKind.PUSHBOOL;
}

export interface PushDataOperation extends Operation {
    readonly kind: OperationKind.PUSHDATA;
    readonly value: Uint8Array
}

export function isPushDataOperation(ins: Operation): ins is PushDataOperation {
    return ins.kind === OperationKind.PUSHDATA;
}

export interface PushIntOperation extends Operation {
    readonly kind: OperationKind.PUSHINT;
    readonly value: bigint;
}

export function isPushIntOperation(ins: Operation): ins is PushIntOperation {
    return ins.kind === OperationKind.PUSHINT;
}

export interface SysCallOperation extends Operation {
    readonly kind: OperationKind.SYSCALL,
    readonly service: NeoService
}

export function isSysCallOperation(ins: Operation): ins is SysCallOperation {
    return ins.kind === OperationKind.SYSCALL;
}

export interface TryOperation extends Operation {
    readonly kind: OperationKind.TRY,
    readonly catchTarget: TargetOffset,
    readonly finallyTarget: TargetOffset,
}

export function isTryOperation(ins: Operation): ins is TryOperation {
    return ins.kind === OperationKind.TRY;
}


export interface TargetOffset {
    instruction: Operation | undefined
}

const jumpOperationKinds = [
    OperationKind.JMP ,
    OperationKind.JMPIF ,
    OperationKind.JMPIFNOT ,
    OperationKind.JMPEQ ,
    OperationKind.JMPNE ,
    OperationKind.JMPGT ,
    OperationKind.JMPGE ,
    OperationKind.JMPLT ,
    OperationKind.JMPLE,
] as const;

export type JumpOperationKind = typeof jumpOperationKinds[number];

export interface JumpOperation extends Operation {
    readonly kind: JumpOperationKind;
    readonly target: TargetOffset;
}

export function isJumpOperation(ins: Operation): ins is JumpOperation {
    return (jumpOperationKinds as ReadonlyArray<OperationKind>).includes(ins.kind);
}

const loadStoreOperationKinds = [
    OperationKind.LDARG,
    OperationKind.LDLOC,
    OperationKind.LDSFLD,
    OperationKind.STARG, 
    OperationKind.STLOC, 
    OperationKind.STSFLD,
] as const;

export type LoadStoreOperationKind = typeof loadStoreOperationKinds[number];

export interface LoadStoreOperation extends Operation {
    readonly kind: LoadStoreOperationKind
    readonly index: number
}

export function isLoadStoreOperation(ins: Operation): ins is LoadStoreOperation {
    return (loadStoreOperationKinds as ReadonlyArray<OperationKind>).includes(ins.kind);
}

export const specializedOperationKinds: ReadonlyArray<OperationKind> = [
    OperationKind.CONVERT,
    OperationKind.INITSLOT,
    OperationKind.PUSHBOOL,
    OperationKind.PUSHDATA,
    OperationKind.PUSHINT,
    OperationKind.SYSCALL,
    OperationKind.TRY,
    ...jumpOperationKinds, 
    ...loadStoreOperationKinds];