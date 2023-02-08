import * as tsm from "ts-morph";
import { ReadonlyUint8Array } from '../utility/ReadonlyArrays';

export type OperationKind = 'pushbool' | 'pushint' | 'pushdata' | 'pushnull' |
    'jump' | 'jumpif' | 'jumpifnot' | 'jumpeq' | 'jumpne' | 'jumpgt' | 'jumpge' | 'jumplt' | 'jumple' |
    'loadarg' | 'storearg' | 'loadlocal' | 'storelocal' | 'loadstatic' | 'storestatic' |
    'noop' | 'return' | 'syscall' | 'initslot' | 'pickitem';

export enum oldOperationKind {

    CALL, // = 52,
    // CALL_L = 53,
    // CALLA = 54,
    // CALLT = 55,
    // ABORT = 56,
    // ASSERT = 57,
    // THROW = 58,
    TRY, // = 59,
    // TRY_L = 60,
    ENDTRY, // = 61,
    // ENDTRY_L = 62,
    // ENDFINALLY = 63,
    // RET = 64,
    // SYSCALL = 65,
    // DEPTH = 67,
    // DROP = 69,
    // NIP = 70,
    // XDROP = 72,
    // CLEAR = 73,
    // DUP = 74,
    // OVER = 75,
    // PICK = 77,
    // TUCK = 78,
    // SWAP = 80,
    // ROT = 81,
    // ROLL = 82,
    // REVERSE3 = 83,
    // REVERSE4 = 84,
    // REVERSEN = 85,
    // INITSSLOT = 86,
    // INITSLOT = 87,
    LDSFLD,
    // LDSFLD0 = 88,
    // LDSFLD1 = 89,
    // LDSFLD2 = 90,
    // LDSFLD3 = 91,
    // LDSFLD4 = 92,
    // LDSFLD5 = 93,
    // LDSFLD6 = 94,
    // LDSFLD = 95,
    STSFLD,
    // STSFLD0 = 96,
    // STSFLD1 = 97,
    // STSFLD2 = 98,
    // STSFLD3 = 99,
    // STSFLD4 = 100,
    // STSFLD5 = 101,
    // STSFLD6 = 102,
    // STSFLD = 103,
    LDLOC,
    // LDLOC0 = 104,
    // LDLOC1 = 105,
    // LDLOC2 = 106,
    // LDLOC3 = 107,
    // LDLOC4 = 108,
    // LDLOC5 = 109,
    // LDLOC6 = 110,
    // LDLOC = 111,
    STLOC,
    // STLOC0 = 112,
    // STLOC1 = 113,
    // STLOC2 = 114,
    // STLOC3 = 115,
    // STLOC4 = 116,
    // STLOC5 = 117,
    // STLOC6 = 118,
    // STLOC = 119,
    LDARG,
    // LDARG0 = 120,
    // LDARG1 = 121,
    // LDARG2 = 122,
    // LDARG3 = 123,
    // LDARG4 = 124,
    // LDARG5 = 125,
    // LDARG6 = 126,
    // LDARG = 127,
    STARG,
    // STARG0 = 128,
    // STARG1 = 129,
    // STARG2 = 130,
    // STARG3 = 131,
    // STARG4 = 132,
    // STARG5 = 133,
    // STARG6 = 134,
    // STARG = 135,
    // NEWBUFFER = 136,
    // MEMCPY = 137,
    // CAT = 139,
    // SUBSTR = 140,
    // LEFT = 141,
    // RIGHT = 142,
    // INVERT = 144,
    // AND = 145,
    // OR = 146,
    // XOR = 147,
    // EQUAL = 151,
    // NOTEQUAL = 152,
    // SIGN = 153,
    // ABS = 154,
    // NEGATE = 155,
    // INC = 156,
    // DEC = 157,
    // ADD = 158,
    // SUB = 159,
    // MUL = 160,
    // DIV = 161,
    // MOD = 162,
    // POW = 163,
    // SQRT = 164,
    // SHL = 168,
    // SHR = 169,
    // NOT = 170,
    // BOOLAND = 171,
    // BOOLOR = 172,
    // NZ = 177,
    // NUMEQUAL = 179,
    // NUMNOTEQUAL = 180,
    // LT = 181,
    // LE = 182,
    // GT = 183,
    // GE = 184,
    // MIN = 185,
    // MAX = 186,
    // WITHIN = 187,
    // PACKMAP = 190,
    // PACKSTRUCT = 191,
    // PACK = 192,
    // UNPACK = 193,
    // NEWARRAY0 = 194,
    // NEWARRAY = 195,
    // NEWARRAY_T = 196,
    // NEWSTRUCT0 = 197,
    // NEWSTRUCT = 198,
    // NEWMAP = 200,
    // SIZE = 202,
    // HASKEY = 203,
    // KEYS = 204,
    // VALUES = 205,
    // PICKITEM = 206,
    // APPEND = 207,
    // SETITEM = 208,
    // REVERSEITEMS = 209,
    // REMOVE = 210,
    // CLEARITEMS = 211,
    // POPITEM = 212,
    // ISNULL = 216,
    // ISTYPE = 217,
    // CONVERT = 219
} 

export type Location = tsm.Node | { start: tsm.Node, end: tsm.Node };

export interface Operation {
    readonly kind: OperationKind,
    location?: Location,
}

export interface SysCallOperation extends Operation { 
    readonly kind: 'syscall',
    readonly name: string
}

export function isSysCallOperation(ins: Operation): ins is SysCallOperation {
    return ins.kind === 'syscall';
}

export interface InitSlotOperation extends Operation {
    readonly kind: 'initslot',
    readonly locals: number,
    readonly params: number
}

export function isInitSlotOperation(ins: Operation): ins is InitSlotOperation {
    return ins.kind === 'initslot';
}

export interface PushDataOperation extends Operation {
    readonly kind: 'pushdata';
    readonly value: ReadonlyUint8Array
}

export function isPushDataOperation(ins: Operation): ins is PushDataOperation {
    return ins.kind === 'pushdata';
}

export interface PushIntOperation extends Operation {
    readonly kind: 'pushint';
    readonly value: bigint;
}

export function isPushIntOperation(ins: Operation): ins is PushIntOperation {
    return ins.kind === 'pushint';
}

export interface PushBoolOperation extends Operation {
    readonly kind: 'pushbool';
    readonly value: boolean;
}

export function isPushBoolOperation(ins: Operation): ins is PushBoolOperation {
    return ins.kind === 'pushbool';
}

const jumpOperationKinds = [
    'jump', 'jumpif', 'jumpifnot', 'jumpeq', 'jumpne', 'jumpgt', 'jumpge', 'jumplt', 'jumple'
] as const as ReadonlyArray<OperationKind>;

export type JumpOperationKind = typeof jumpOperationKinds[number];

export interface JumpOperation extends Operation {
    readonly kind: JumpOperationKind;
    readonly offset: number;
}

export function isJumpOperation(ins: Operation): ins is JumpOperation {
    return jumpOperationKinds.includes(ins.kind);
}

const loadStoreOperationKinds = [
    'loadarg', 'storearg', 'loadlocal', 'storelocal', 'loadstatic', 'storestatic'
] as const as ReadonlyArray<OperationKind>;

export type LoadStoreOperationKind = typeof loadStoreOperationKinds[number];

export interface LoadStoreOperation extends Operation {
    readonly kind: LoadStoreOperationKind
    readonly index: number
}

export function isLoadStoreOperation(ins: Operation): ins is LoadStoreOperation {
    return loadStoreOperationKinds.includes(ins.kind);
}
