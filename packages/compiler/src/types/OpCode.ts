// List of NeoVM OpCodes generated from C#:
//      foreach (var opCode in Enum.GetValues<Neo.VM.OpCode>()) {
//          Console.WriteLine($"{opCode} = 0x{(byte)opCode:x2},");
//      }

import { Lazy } from "../utility/Lazy";

export const enum OpCode {
    PUSHINT8 = 0x00,
    PUSHINT16 = 0x01,
    PUSHINT32 = 0x02,
    PUSHINT64 = 0x03,
    PUSHINT128 = 0x04,
    PUSHINT256 = 0x05,
    PUSHA = 0x0a,
    PUSHNULL = 0x0b,
    PUSHDATA1 = 0x0c,
    PUSHDATA2 = 0x0d,
    PUSHDATA4 = 0x0e,
    PUSHM1 = 0x0f,
    PUSH0 = 0x10,
    PUSH1 = 0x11,
    PUSH2 = 0x12,
    PUSH3 = 0x13,
    PUSH4 = 0x14,
    PUSH5 = 0x15,
    PUSH6 = 0x16,
    PUSH7 = 0x17,
    PUSH8 = 0x18,
    PUSH9 = 0x19,
    PUSH10 = 0x1a,
    PUSH11 = 0x1b,
    PUSH12 = 0x1c,
    PUSH13 = 0x1d,
    PUSH14 = 0x1e,
    PUSH15 = 0x1f,
    PUSH16 = 0x20,
    NOP = 0x21,
    JMP = 0x22,
    JMP_L = 0x23,
    JMPIF = 0x24,
    JMPIF_L = 0x25,
    JMPIFNOT = 0x26,
    JMPIFNOT_L = 0x27,
    JMPEQ = 0x28,
    JMPEQ_L = 0x29,
    JMPNE = 0x2a,
    JMPNE_L = 0x2b,
    JMPGT = 0x2c,
    JMPGT_L = 0x2d,
    JMPGE = 0x2e,
    JMPGE_L = 0x2f,
    JMPLT = 0x30,
    JMPLT_L = 0x31,
    JMPLE = 0x32,
    JMPLE_L = 0x33,
    CALL = 0x34,
    CALL_L = 0x35,
    CALLA = 0x36,
    CALLT = 0x37,
    ABORT = 0x38,
    ASSERT = 0x39,
    THROW = 0x3a,
    TRY = 0x3b,
    TRY_L = 0x3c,
    ENDTRY = 0x3d,
    ENDTRY_L = 0x3e,
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
    LDSFLD0 = 0x58,
    LDSFLD1 = 0x59,
    LDSFLD2 = 0x5a,
    LDSFLD3 = 0x5b,
    LDSFLD4 = 0x5c,
    LDSFLD5 = 0x5d,
    LDSFLD6 = 0x5e,
    LDSFLD = 0x5f,
    STSFLD0 = 0x60,
    STSFLD1 = 0x61,
    STSFLD2 = 0x62,
    STSFLD3 = 0x63,
    STSFLD4 = 0x64,
    STSFLD5 = 0x65,
    STSFLD6 = 0x66,
    STSFLD = 0x67,
    LDLOC0 = 0x68,
    LDLOC1 = 0x69,
    LDLOC2 = 0x6a,
    LDLOC3 = 0x6b,
    LDLOC4 = 0x6c,
    LDLOC5 = 0x6d,
    LDLOC6 = 0x6e,
    LDLOC = 0x6f,
    STLOC0 = 0x70,
    STLOC1 = 0x71,
    STLOC2 = 0x72,
    STLOC3 = 0x73,
    STLOC4 = 0x74,
    STLOC5 = 0x75,
    STLOC6 = 0x76,
    STLOC = 0x77,
    LDARG0 = 0x78,
    LDARG1 = 0x79,
    LDARG2 = 0x7a,
    LDARG3 = 0x7b,
    LDARG4 = 0x7c,
    LDARG5 = 0x7d,
    LDARG6 = 0x7e,
    LDARG = 0x7f,
    STARG0 = 0x80,
    STARG1 = 0x81,
    STARG2 = 0x82,
    STARG3 = 0x83,
    STARG4 = 0x84,
    STARG5 = 0x85,
    STARG6 = 0x86,
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

// Other single target op codes:
//  * OpCode.CALL
//  * OpCode.CALL_L
//  * OpCode.PUSHA
//  * OpCode.ENDTRY
//  * OpCode.ENDTRY_L

export type JumpOpCode = 
    OpCode.JMP |
    OpCode.JMP_L |
    OpCode.JMPIF |
    OpCode.JMPIF_L |
    OpCode.JMPIFNOT |
    OpCode.JMPIFNOT_L |
    OpCode.JMPEQ |
    OpCode.JMPEQ_L |
    OpCode.JMPNE |
    OpCode.JMPNE_L |
    OpCode.JMPGT |
    OpCode.JMPGT_L |
    OpCode.JMPGE |
    OpCode.JMPGE_L |
    OpCode.JMPLT |
    OpCode.JMPLT_L |
    OpCode.JMPLE |
    OpCode.JMPLE_L;

export function isJumpOpCode(opCode: OpCode) { return OpCode.JMP <= opCode && opCode <= OpCode.JMPLE_L; }

export type TryOpCode = 
    OpCode.TRY | 
    OpCode.TRY_L;

export function toString(opCode: OpCode): string {
    switch (opCode) {
        case OpCode.PUSHINT8: return "PUSHINT8";
        case OpCode.PUSHINT16: return "PUSHINT16";
        case OpCode.PUSHINT32: return "PUSHINT32";
        case OpCode.PUSHINT64: return "PUSHINT64";
        case OpCode.PUSHINT128: return "PUSHINT128";
        case OpCode.PUSHINT256: return "PUSHINT256";
        case OpCode.PUSHA: return "PUSHA";
        case OpCode.PUSHNULL: return "PUSHNULL";
        case OpCode.PUSHDATA1: return "PUSHDATA1";
        case OpCode.PUSHDATA2: return "PUSHDATA2";
        case OpCode.PUSHDATA4: return "PUSHDATA4";
        case OpCode.PUSHM1: return "PUSHM1";
        case OpCode.PUSH0: return "PUSH0";
        case OpCode.PUSH1: return "PUSH1";
        case OpCode.PUSH2: return "PUSH2";
        case OpCode.PUSH3: return "PUSH3";
        case OpCode.PUSH4: return "PUSH4";
        case OpCode.PUSH5: return "PUSH5";
        case OpCode.PUSH6: return "PUSH6";
        case OpCode.PUSH7: return "PUSH7";
        case OpCode.PUSH8: return "PUSH8";
        case OpCode.PUSH9: return "PUSH9";
        case OpCode.PUSH10: return "PUSH10";
        case OpCode.PUSH11: return "PUSH11";
        case OpCode.PUSH12: return "PUSH12";
        case OpCode.PUSH13: return "PUSH13";
        case OpCode.PUSH14: return "PUSH14";
        case OpCode.PUSH15: return "PUSH15";
        case OpCode.PUSH16: return "PUSH16";
        case OpCode.NOP: return "NOP";
        case OpCode.JMP: return "JMP";
        case OpCode.JMP_L: return "JMP_L";
        case OpCode.JMPIF: return "JMPIF";
        case OpCode.JMPIF_L: return "JMPIF_L";
        case OpCode.JMPIFNOT: return "JMPIFNOT";
        case OpCode.JMPIFNOT_L: return "JMPIFNOT_L";
        case OpCode.JMPEQ: return "JMPEQ";
        case OpCode.JMPEQ_L: return "JMPEQ_L";
        case OpCode.JMPNE: return "JMPNE";
        case OpCode.JMPNE_L: return "JMPNE_L";
        case OpCode.JMPGT: return "JMPGT";
        case OpCode.JMPGT_L: return "JMPGT_L";
        case OpCode.JMPGE: return "JMPGE";
        case OpCode.JMPGE_L: return "JMPGE_L";
        case OpCode.JMPLT: return "JMPLT";
        case OpCode.JMPLT_L: return "JMPLT_L";
        case OpCode.JMPLE: return "JMPLE";
        case OpCode.JMPLE_L: return "JMPLE_L";
        case OpCode.CALL: return "CALL";
        case OpCode.CALL_L: return "CALL_L";
        case OpCode.CALLA: return "CALLA";
        case OpCode.CALLT: return "CALLT";
        case OpCode.ABORT: return "ABORT";
        case OpCode.ASSERT: return "ASSERT";
        case OpCode.THROW: return "THROW";
        case OpCode.TRY: return "TRY";
        case OpCode.TRY_L: return "TRY_L";
        case OpCode.ENDTRY: return "ENDTRY";
        case OpCode.ENDTRY_L: return "ENDTRY_L";
        case OpCode.ENDFINALLY: return "ENDFINALLY";
        case OpCode.RET: return "RET";
        case OpCode.SYSCALL: return "SYSCALL";
        case OpCode.DEPTH: return "DEPTH";
        case OpCode.DROP: return "DROP";
        case OpCode.NIP: return "NIP";
        case OpCode.XDROP: return "XDROP";
        case OpCode.CLEAR: return "CLEAR";
        case OpCode.DUP: return "DUP";
        case OpCode.OVER: return "OVER";
        case OpCode.PICK: return "PICK";
        case OpCode.TUCK: return "TUCK";
        case OpCode.SWAP: return "SWAP";
        case OpCode.ROT: return "ROT";
        case OpCode.ROLL: return "ROLL";
        case OpCode.REVERSE3: return "REVERSE3";
        case OpCode.REVERSE4: return "REVERSE4";
        case OpCode.REVERSEN: return "REVERSEN";
        case OpCode.INITSSLOT: return "INITSSLOT";
        case OpCode.INITSLOT: return "INITSLOT";
        case OpCode.LDSFLD0: return "LDSFLD0";
        case OpCode.LDSFLD1: return "LDSFLD1";
        case OpCode.LDSFLD2: return "LDSFLD2";
        case OpCode.LDSFLD3: return "LDSFLD3";
        case OpCode.LDSFLD4: return "LDSFLD4";
        case OpCode.LDSFLD5: return "LDSFLD5";
        case OpCode.LDSFLD6: return "LDSFLD6";
        case OpCode.LDSFLD: return "LDSFLD";
        case OpCode.STSFLD0: return "STSFLD0";
        case OpCode.STSFLD1: return "STSFLD1";
        case OpCode.STSFLD2: return "STSFLD2";
        case OpCode.STSFLD3: return "STSFLD3";
        case OpCode.STSFLD4: return "STSFLD4";
        case OpCode.STSFLD5: return "STSFLD5";
        case OpCode.STSFLD6: return "STSFLD6";
        case OpCode.STSFLD: return "STSFLD";
        case OpCode.LDLOC0: return "LDLOC0";
        case OpCode.LDLOC1: return "LDLOC1";
        case OpCode.LDLOC2: return "LDLOC2";
        case OpCode.LDLOC3: return "LDLOC3";
        case OpCode.LDLOC4: return "LDLOC4";
        case OpCode.LDLOC5: return "LDLOC5";
        case OpCode.LDLOC6: return "LDLOC6";
        case OpCode.LDLOC: return "LDLOC";
        case OpCode.STLOC0: return "STLOC0";
        case OpCode.STLOC1: return "STLOC1";
        case OpCode.STLOC2: return "STLOC2";
        case OpCode.STLOC3: return "STLOC3";
        case OpCode.STLOC4: return "STLOC4";
        case OpCode.STLOC5: return "STLOC5";
        case OpCode.STLOC6: return "STLOC6";
        case OpCode.STLOC: return "STLOC";
        case OpCode.LDARG0: return "LDARG0";
        case OpCode.LDARG1: return "LDARG1";
        case OpCode.LDARG2: return "LDARG2";
        case OpCode.LDARG3: return "LDARG3";
        case OpCode.LDARG4: return "LDARG4";
        case OpCode.LDARG5: return "LDARG5";
        case OpCode.LDARG6: return "LDARG6";
        case OpCode.LDARG: return "LDARG";
        case OpCode.STARG0: return "STARG0";
        case OpCode.STARG1: return "STARG1";
        case OpCode.STARG2: return "STARG2";
        case OpCode.STARG3: return "STARG3";
        case OpCode.STARG4: return "STARG4";
        case OpCode.STARG5: return "STARG5";
        case OpCode.STARG6: return "STARG6";
        case OpCode.STARG: return "STARG";
        case OpCode.NEWBUFFER: return "NEWBUFFER";
        case OpCode.MEMCPY: return "MEMCPY";
        case OpCode.CAT: return "CAT";
        case OpCode.SUBSTR: return "SUBSTR";
        case OpCode.LEFT: return "LEFT";
        case OpCode.RIGHT: return "RIGHT";
        case OpCode.INVERT: return "INVERT";
        case OpCode.AND: return "AND";
        case OpCode.OR: return "OR";
        case OpCode.XOR: return "XOR";
        case OpCode.EQUAL: return "EQUAL";
        case OpCode.NOTEQUAL: return "NOTEQUAL";
        case OpCode.SIGN: return "SIGN";
        case OpCode.ABS: return "ABS";
        case OpCode.NEGATE: return "NEGATE";
        case OpCode.INC: return "INC";
        case OpCode.DEC: return "DEC";
        case OpCode.ADD: return "ADD";
        case OpCode.SUB: return "SUB";
        case OpCode.MUL: return "MUL";
        case OpCode.DIV: return "DIV";
        case OpCode.MOD: return "MOD";
        case OpCode.POW: return "POW";
        case OpCode.SQRT: return "SQRT";
        case OpCode.MODMUL: return "MODMUL";
        case OpCode.MODPOW: return "MODPOW";
        case OpCode.SHL: return "SHL";
        case OpCode.SHR: return "SHR";
        case OpCode.NOT: return "NOT";
        case OpCode.BOOLAND: return "BOOLAND";
        case OpCode.BOOLOR: return "BOOLOR";
        case OpCode.NZ: return "NZ";
        case OpCode.NUMEQUAL: return "NUMEQUAL";
        case OpCode.NUMNOTEQUAL: return "NUMNOTEQUAL";
        case OpCode.LT: return "LT";
        case OpCode.LE: return "LE";
        case OpCode.GT: return "GT";
        case OpCode.GE: return "GE";
        case OpCode.MIN: return "MIN";
        case OpCode.MAX: return "MAX";
        case OpCode.WITHIN: return "WITHIN";
        case OpCode.PACKMAP: return "PACKMAP";
        case OpCode.PACKSTRUCT: return "PACKSTRUCT";
        case OpCode.PACK: return "PACK";
        case OpCode.UNPACK: return "UNPACK";
        case OpCode.NEWARRAY0: return "NEWARRAY0";
        case OpCode.NEWARRAY: return "NEWARRAY";
        case OpCode.NEWARRAY_T: return "NEWARRAY_T";
        case OpCode.NEWSTRUCT0: return "NEWSTRUCT0";
        case OpCode.NEWSTRUCT: return "NEWSTRUCT";
        case OpCode.NEWMAP: return "NEWMAP";
        case OpCode.SIZE: return "SIZE";
        case OpCode.HASKEY: return "HASKEY";
        case OpCode.KEYS: return "KEYS";
        case OpCode.VALUES: return "VALUES";
        case OpCode.PICKITEM: return "PICKITEM";
        case OpCode.APPEND: return "APPEND";
        case OpCode.SETITEM: return "SETITEM";
        case OpCode.REVERSEITEMS: return "REVERSEITEMS";
        case OpCode.REMOVE: return "REMOVE";
        case OpCode.CLEARITEMS: return "CLEARITEMS";
        case OpCode.POPITEM: return "POPITEM";
        case OpCode.ISNULL: return "ISNULL";
        case OpCode.ISTYPE: return "ISTYPE";
        case OpCode.CONVERT: return "CONVERT";
        default: throw new Error(`Unrecognized VmOpCode ${opCode}`);
    }
}

export interface OpCodeAnnotation {
    operandSize?: number;
    operandSizePrefix?: number;
}

const annotationMap = new Lazy<ReadonlyMap<OpCode, OpCodeAnnotation>>(() => {
    return new Map<OpCode, OpCodeAnnotation>([
        [OpCode.PUSHINT8, { operandSize: 1 }],
        [OpCode.PUSHINT16, { operandSize: 2 }],
        [OpCode.PUSHINT32, { operandSize: 4 }],
        [OpCode.PUSHINT64, { operandSize: 8 }],
        [OpCode.PUSHINT128, { operandSize: 16 }],
        [OpCode.PUSHINT256, { operandSize: 32 }],
        [OpCode.PUSHA, { operandSize: 4 }],
        [OpCode.PUSHDATA1, { operandSizePrefix: 1 }],
        [OpCode.PUSHDATA2, { operandSizePrefix: 2 }],
        [OpCode.PUSHDATA4, { operandSizePrefix: 4 }],
        [OpCode.JMP, { operandSize: 1 }],
        [OpCode.JMP_L, { operandSize: 4 }],
        [OpCode.JMPIF, { operandSize: 1 }],
        [OpCode.JMPIF_L, { operandSize: 4 }],
        [OpCode.JMPIFNOT, { operandSize: 1 }],
        [OpCode.JMPIFNOT_L, { operandSize: 4 }],
        [OpCode.JMPEQ, { operandSize: 1 }],
        [OpCode.JMPEQ_L, { operandSize: 4 }],
        [OpCode.JMPNE, { operandSize: 1 }],
        [OpCode.JMPNE_L, { operandSize: 4 }],
        [OpCode.JMPGT, { operandSize: 1 }],
        [OpCode.JMPGT_L, { operandSize: 4 }],
        [OpCode.JMPGE, { operandSize: 1 }],
        [OpCode.JMPGE_L, { operandSize: 4 }],
        [OpCode.JMPLT, { operandSize: 1 }],
        [OpCode.JMPLT_L, { operandSize: 4 }],
        [OpCode.JMPLE, { operandSize: 1 }],
        [OpCode.JMPLE_L, { operandSize: 4 }],
        [OpCode.CALL, { operandSize: 1 }],
        [OpCode.CALL_L, { operandSize: 4 }],
        [OpCode.CALLT, { operandSize: 2 }],
        [OpCode.TRY, { operandSize: 2 }],
        [OpCode.TRY_L, { operandSize: 8 }],
        [OpCode.ENDTRY, { operandSize: 1 }],
        [OpCode.ENDTRY_L, { operandSize: 4 }],
        [OpCode.SYSCALL, { operandSize: 4 }],
        [OpCode.INITSSLOT, { operandSize: 1 }],
        [OpCode.INITSLOT, { operandSize: 2 }],
        [OpCode.LDSFLD, { operandSize: 1 }],
        [OpCode.STSFLD, { operandSize: 1 }],
        [OpCode.LDLOC, { operandSize: 1 }],
        [OpCode.STLOC, { operandSize: 1 }],
        [OpCode.LDARG, { operandSize: 1 }],
        [OpCode.STARG, { operandSize: 1 }],
        [OpCode.NEWARRAY_T, { operandSize: 1 }],
        [OpCode.ISTYPE, { operandSize: 1 }],
        [OpCode.CONVERT, { operandSize: 1 }],
    ]);
});

export function getAnnotation(opCode: OpCode): OpCodeAnnotation | undefined {
    return annotationMap.instance.get(opCode);
}
