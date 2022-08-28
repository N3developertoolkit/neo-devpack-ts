import { sc } from '@cityofzion/neon-core'
import * as tsm from "ts-morph";

// Instruction Kind is slightly simplified version of NeoVM OpCode enum
//  * All the PUSHINT* opcodes are folded into a single Instruction Kind
//  * The PUSHDATA? opcodes are folded into a single Instruction Kind
//  * All the opcode pairs with and without an _L variant have been folded into a single Instruction Kind
//  * the hard coded index Load/Store opcodes have been folded into a single Instruction Kind 
export enum OperationKind {
    PUSHINT,
    // PUSHINT8 = 0x00,
    // PUSHINT16 = 0x01,
    // PUSHINT32 = 0x02,
    // PUSHINT64 = 0x03,
    // PUSHINT128 = 0x04,
    // PUSHINT256 = 0x05,
    PUSHA = 0x0a,
    PUSHNULL = 0x0b,
    PUSHDATA,
    // PUSHDATA1 = 0x0c,
    // PUSHDATA2 = 0x0d,
    // PUSHDATA4 = 0x0e,
    // PUSHM1 = 0x0f,
    // PUSH0 = 0x10,
    // PUSH1 = 0x11,
    // PUSH2 = 0x12,
    // PUSH3 = 0x13,
    // PUSH4 = 0x14,
    // PUSH5 = 0x15,
    // PUSH6 = 0x16,
    // PUSH7 = 0x17,
    // PUSH8 = 0x18,
    // PUSH9 = 0x19,
    // PUSH10 = 0x1a,
    // PUSH11 = 0x1b,
    // PUSH12 = 0x1c,
    // PUSH13 = 0x1d,
    // PUSH14 = 0x1e,
    // PUSH15 = 0x1f,
    // PUSH16 = 0x20,
    NOP = 0x21,
    JMP = 0x22,
    // JMP_L = 0x23,
    JMPIF = 0x24,
    // JMPIF_L = 0x25,
    JMPIFNOT = 0x26,
    // JMPIFNOT_L = 0x27,
    JMPEQ = 0x28,
    // JMPEQ_L = 0x29,
    JMPNE = 0x2a,
    // JMPNE_L = 0x2b,
    JMPGT = 0x2c,
    // JMPGT_L = 0x2d,
    JMPGE = 0x2e,
    // JMPGE_L = 0x2f,
    JMPLT = 0x30,
    // JMPLT_L = 0x31,
    JMPLE = 0x32,
    // JMPLE_L = 0x33,
    CALL = 0x34,
    // CALL_L = 0x35,
    CALLA = 0x36,
    CALLT = 0x37,
    ABORT = 0x38,
    ASSERT = 0x39,
    THROW = 0x3a,
    TRY = 0x3b,
    // TRY_L = 0x3c,
    ENDTRY = 0x3d,
    // ENDTRY_L = 0x3e,
    ENDFINALLY = 0x3f,
    RET = 0x40,
    SYSCALL = 0x41,
    DEPTH = 0x43,
    DROP = 0x45,
    NIP = 0x46,
    XDROP = 0x48,
    CLEAR = 0x49,
    DUP = 0x4a,
    OVER = 0x4b,
    PICK = 0x4d,
    TUCK = 0x4e,
    SWAP = 0x50,
    ROT = 0x51,
    ROLL = 0x52,
    REVERSE3 = 0x53,
    REVERSE4 = 0x54,
    REVERSEN = 0x55,
    INITSSLOT = 0x56,
    INITSLOT = 0x57,
    // LDSFLD0 = 0x58,
    // LDSFLD1 = 0x59,
    // LDSFLD2 = 0x5a,
    // LDSFLD3 = 0x5b,
    // LDSFLD4 = 0x5c,
    // LDSFLD5 = 0x5d,
    // LDSFLD6 = 0x5e,
    LDSFLD = 0x5f,
    // STSFLD0 = 0x60,
    // STSFLD1 = 0x61,
    // STSFLD2 = 0x62,
    // STSFLD3 = 0x63,
    // STSFLD4 = 0x64,
    // STSFLD5 = 0x65,
    // STSFLD6 = 0x66,
    STSFLD = 0x67,
    // LDLOC0 = 0x68,
    // LDLOC1 = 0x69,
    // LDLOC2 = 0x6a,
    // LDLOC3 = 0x6b,
    // LDLOC4 = 0x6c,
    // LDLOC5 = 0x6d,
    // LDLOC6 = 0x6e,
    LDLOC = 0x6f,
    // STLOC0 = 0x70,
    // STLOC1 = 0x71,
    // STLOC2 = 0x72,
    // STLOC3 = 0x73,
    // STLOC4 = 0x74,
    // STLOC5 = 0x75,
    // STLOC6 = 0x76,
    STLOC = 0x77,
    // LDARG0 = 0x78,
    // LDARG1 = 0x79,
    // LDARG2 = 0x7a,
    // LDARG3 = 0x7b,
    // LDARG4 = 0x7c,
    // LDARG5 = 0x7d,
    // LDARG6 = 0x7e,
    LDARG = 0x7f,
    // STARG0 = 0x80,
    // STARG1 = 0x81,
    // STARG2 = 0x82,
    // STARG3 = 0x83,
    // STARG4 = 0x84,
    // STARG5 = 0x85,
    // STARG6 = 0x86,
    STARG = 0x87,
    NEWBUFFER = 0x88,
    MEMCPY = 0x89,
    CAT = 0x8b,
    SUBSTR = 0x8c,
    LEFT = 0x8d,
    RIGHT = 0x8e,
    INVERT = 0x90,
    AND = 0x91,
    OR = 0x92,
    XOR = 0x93,
    EQUAL = 0x97,
    NOTEQUAL = 0x98,
    SIGN = 0x99,
    ABS = 0x9a,
    NEGATE = 0x9b,
    INC = 0x9c,
    DEC = 0x9d,
    ADD = 0x9e,
    SUB = 0x9f,
    MUL = 0xa0,
    DIV = 0xa1,
    MOD = 0xa2,
    POW = 0xa3,
    SQRT = 0xa4,
    MODMUL = 0xa5,
    MODPOW = 0xa6,
    SHL = 0xa8,
    SHR = 0xa9,
    NOT = 0xaa,
    BOOLAND = 0xab,
    BOOLOR = 0xac,
    NZ = 0xb1,
    NUMEQUAL = 0xb3,
    NUMNOTEQUAL = 0xb4,
    LT = 0xb5,
    LE = 0xb6,
    GT = 0xb7,
    GE = 0xb8,
    MIN = 0xb9,
    MAX = 0xba,
    WITHIN = 0xbb,
    PACKMAP = 0xbe,
    PACKSTRUCT = 0xbf,
    PACK = 0xc0,
    UNPACK = 0xc1,
    NEWARRAY0 = 0xc2,
    NEWARRAY = 0xc3,
    NEWARRAY_T = 0xc4,
    NEWSTRUCT0 = 0xc5,
    NEWSTRUCT = 0xc6,
    NEWMAP = 0xc8,
    SIZE = 0xca,
    HASKEY = 0xcb,
    KEYS = 0xcc,
    VALUES = 0xcd,
    PICKITEM = 0xce,
    APPEND = 0xcf,
    SETITEM = 0xd0,
    REVERSEITEMS = 0xd1,
    REMOVE = 0xd2,
    CLEARITEMS = 0xd3,
    POPITEM = 0xd4,
    ISNULL = 0xd8,
    ISTYPE = 0xd9,
    CONVERT = 0xdb,
} 
export interface Operation {
    readonly kind: OperationKind,
    location?: tsm.Node,
}

export interface ConvertOperation extends Operation {
    readonly kind: OperationKind.CONVERT;
    readonly type: sc.StackItemType
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
    readonly service: sc.InteropServiceCode
}

export function isSysCallOperation(ins: Operation): ins is SysCallOperation {
    return ins.kind === OperationKind.SYSCALL;
}

export interface TryOperation extends Operation {
    readonly kind: OperationKind.TRY,
    readonly catchOffset: number,
    readonly finallyOffset: number,
}

export function isTryOperation(ins: Operation): ins is TryOperation {
    return ins.kind === OperationKind.TRY;
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
    readonly offset: number;
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
    OperationKind.PUSHDATA,
    OperationKind.PUSHINT,
    OperationKind.SYSCALL,
    OperationKind.TRY,
    ...jumpOperationKinds, 
    ...loadStoreOperationKinds];