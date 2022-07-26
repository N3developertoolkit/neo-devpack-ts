import { sc } from "@cityofzion/neon-core";

/* spell-checker: disable */
export function isTargetOpCode(opCode: sc.OpCode) {
    switch (opCode) {
        case sc.OpCode.JMP:
        case sc.OpCode.JMP_L:
        case sc.OpCode.JMPIF:
        case sc.OpCode.JMPIF_L:
        case sc.OpCode.JMPIFNOT:
        case sc.OpCode.JMPIFNOT_L:
        case sc.OpCode.JMPEQ:
        case sc.OpCode.JMPEQ_L:
        case sc.OpCode.JMPNE:
        case sc.OpCode.JMPNE_L:
        case sc.OpCode.JMPGT:
        case sc.OpCode.JMPGT_L:
        case sc.OpCode.JMPGE:
        case sc.OpCode.JMPGE_L:
        case sc.OpCode.JMPLT:
        case sc.OpCode.JMPLT_L:
        case sc.OpCode.JMPLE:
        case sc.OpCode.JMPLE_L:
        case sc.OpCode.CALL:
        case sc.OpCode.CALL_L:
        case sc.OpCode.PUSHA:
        case sc.OpCode.ENDTRY:
        case sc.OpCode.ENDTRY_L:
            return true;
        default:
            return false;
    }
}
/* spell-checker: enable */

export function isTryOpCode(opCode: sc.OpCode) {
    return opCode === sc.OpCode.TRY
        || opCode === sc.OpCode.TRY_L;
}

export function isPushDataOpCode(opCode: sc.OpCode) {
    return opCode === sc.OpCode.PUSHDATA1
        || opCode === sc.OpCode.PUSHDATA2
        || opCode === sc.OpCode.PUSHDATA4;
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

export interface OpCodeAnnotation {
    /** Number of bytes to read as params. */
    operandSize?: number;
    /** Number of bytes to read to get the number that is the bytes to read as params. */
    operandSizePrefix?: number;
}

/** Annotation details for OpCode. Tracks neo-vm/OpCode.cs */
// eslint-disable-next-line @typescript-eslint/naming-convention
/* spell-checker: disable */
export const OpCodeAnnotations: Record<sc.OpCode, OpCodeAnnotation> = {
    [sc.OpCode.PUSHINT8]: { operandSize: 1 },
    [sc.OpCode.PUSHINT16]: { operandSize: 2 },
    [sc.OpCode.PUSHINT32]: { operandSize: 4 },
    [sc.OpCode.PUSHINT64]: { operandSize: 8 },
    [sc.OpCode.PUSHINT128]: { operandSize: 16 },
    [sc.OpCode.PUSHINT256]: { operandSize: 32 },
    [sc.OpCode.PUSHA]: { operandSize: 4 },
    [sc.OpCode.PUSHNULL]: {},
    [sc.OpCode.PUSHDATA1]: { operandSizePrefix: 1 },
    [sc.OpCode.PUSHDATA2]: { operandSizePrefix: 2 },
    [sc.OpCode.PUSHDATA4]: { operandSizePrefix: 4 },
    [sc.OpCode.PUSHM1]: {},
    [sc.OpCode.PUSH0]: {},
    [sc.OpCode.PUSH1]: {},
    [sc.OpCode.PUSH2]: {},
    [sc.OpCode.PUSH3]: {},
    [sc.OpCode.PUSH4]: {},
    [sc.OpCode.PUSH5]: {},
    [sc.OpCode.PUSH6]: {},
    [sc.OpCode.PUSH7]: {},
    [sc.OpCode.PUSH8]: {},
    [sc.OpCode.PUSH9]: {},
    [sc.OpCode.PUSH10]: {},
    [sc.OpCode.PUSH11]: {},
    [sc.OpCode.PUSH12]: {},
    [sc.OpCode.PUSH13]: {},
    [sc.OpCode.PUSH14]: {},
    [sc.OpCode.PUSH15]: {},
    [sc.OpCode.PUSH16]: {},
    [sc.OpCode.NOP]: {},
    [sc.OpCode.JMP]: { operandSize: 1 },
    [sc.OpCode.JMP_L]: { operandSize: 4 },
    [sc.OpCode.JMPIF]: { operandSize: 1 },
    [sc.OpCode.JMPIF_L]: { operandSize: 4 },
    [sc.OpCode.JMPIFNOT]: { operandSize: 1 },
    [sc.OpCode.JMPIFNOT_L]: { operandSize: 4 },
    [sc.OpCode.JMPEQ]: { operandSize: 1 },
    [sc.OpCode.JMPEQ_L]: { operandSize: 4 },
    [sc.OpCode.JMPNE]: { operandSize: 1 },
    [sc.OpCode.JMPNE_L]: { operandSize: 4 },
    [sc.OpCode.JMPGT]: { operandSize: 1 },
    [sc.OpCode.JMPGT_L]: { operandSize: 4 },
    [sc.OpCode.JMPGE]: { operandSize: 1 },
    [sc.OpCode.JMPGE_L]: { operandSize: 4 },
    [sc.OpCode.JMPLT]: { operandSize: 1 },
    [sc.OpCode.JMPLT_L]: { operandSize: 4 },
    [sc.OpCode.JMPLE]: { operandSize: 1 },
    [sc.OpCode.JMPLE_L]: { operandSize: 4 },
    [sc.OpCode.CALL]: { operandSize: 1 },
    [sc.OpCode.CALL_L]: { operandSize: 4 },
    [sc.OpCode.CALLA]: {},
    [sc.OpCode.CALLT]: { operandSize: 2 },
    [sc.OpCode.ABORT]: {},
    [sc.OpCode.ASSERT]: {},
    [sc.OpCode.THROW]: {},
    [sc.OpCode.TRY]: { operandSize: 2 },
    [sc.OpCode.TRY_L]: { operandSize: 8 },
    [sc.OpCode.ENDTRY]: { operandSize: 1 },
    [sc.OpCode.ENDTRY_L]: { operandSize: 4 },
    [sc.OpCode.ENDFINALLY]: {},
    [sc.OpCode.RET]: {},
    [sc.OpCode.SYSCALL]: { operandSize: 4 },
    [sc.OpCode.DEPTH]: {},
    [sc.OpCode.DROP]: {},
    [sc.OpCode.NIP]: {},
    [sc.OpCode.XDROP]: {},
    [sc.OpCode.CLEAR]: {},
    [sc.OpCode.DUP]: {},
    [sc.OpCode.OVER]: {},
    [sc.OpCode.PICK]: {},
    [sc.OpCode.TUCK]: {},
    [sc.OpCode.SWAP]: {},
    [sc.OpCode.ROT]: {},
    [sc.OpCode.ROLL]: {},
    [sc.OpCode.REVERSE3]: {},
    [sc.OpCode.REVERSE4]: {},
    [sc.OpCode.REVERSEN]: {},
    [sc.OpCode.INITSSLOT]: { operandSize: 1 },
    [sc.OpCode.INITSLOT]: { operandSize: 2 },
    [sc.OpCode.LDSFLD0]: {},
    [sc.OpCode.LDSFLD1]: {},
    [sc.OpCode.LDSFLD2]: {},
    [sc.OpCode.LDSFLD3]: {},
    [sc.OpCode.LDSFLD4]: {},
    [sc.OpCode.LDSFLD5]: {},
    [sc.OpCode.LDSFLD6]: {},
    [sc.OpCode.LDSFLD]: { operandSize: 1 },
    [sc.OpCode.STSFLD0]: {},
    [sc.OpCode.STSFLD1]: {},
    [sc.OpCode.STSFLD2]: {},
    [sc.OpCode.STSFLD3]: {},
    [sc.OpCode.STSFLD4]: {},
    [sc.OpCode.STSFLD5]: {},
    [sc.OpCode.STSFLD6]: {},
    [sc.OpCode.STSFLD]: { operandSize: 1 },
    [sc.OpCode.LDLOC0]: {},
    [sc.OpCode.LDLOC1]: {},
    [sc.OpCode.LDLOC2]: {},
    [sc.OpCode.LDLOC3]: {},
    [sc.OpCode.LDLOC4]: {},
    [sc.OpCode.LDLOC5]: {},
    [sc.OpCode.LDLOC6]: {},
    [sc.OpCode.LDLOC]: { operandSize: 1 },
    [sc.OpCode.STLOC0]: {},
    [sc.OpCode.STLOC1]: {},
    [sc.OpCode.STLOC2]: {},
    [sc.OpCode.STLOC3]: {},
    [sc.OpCode.STLOC4]: {},
    [sc.OpCode.STLOC5]: {},
    [sc.OpCode.STLOC6]: {},
    [sc.OpCode.STLOC]: { operandSize: 1 },
    [sc.OpCode.LDARG0]: {},
    [sc.OpCode.LDARG1]: {},
    [sc.OpCode.LDARG2]: {},
    [sc.OpCode.LDARG3]: {},
    [sc.OpCode.LDARG4]: {},
    [sc.OpCode.LDARG5]: {},
    [sc.OpCode.LDARG6]: {},
    [sc.OpCode.LDARG]: { operandSize: 1 },
    [sc.OpCode.STARG0]: {},
    [sc.OpCode.STARG1]: {},
    [sc.OpCode.STARG2]: {},
    [sc.OpCode.STARG3]: {},
    [sc.OpCode.STARG4]: {},
    [sc.OpCode.STARG5]: {},
    [sc.OpCode.STARG6]: {},
    [sc.OpCode.STARG]: { operandSize: 1 },
    [sc.OpCode.NEWBUFFER]: {},
    [sc.OpCode.MEMCPY]: {},
    [sc.OpCode.CAT]: {},
    [sc.OpCode.SUBSTR]: {},
    [sc.OpCode.LEFT]: {},
    [sc.OpCode.RIGHT]: {},
    [sc.OpCode.INVERT]: {},
    [sc.OpCode.AND]: {},
    [sc.OpCode.OR]: {},
    [sc.OpCode.XOR]: {},
    [sc.OpCode.EQUAL]: {},
    [sc.OpCode.NOTEQUAL]: {},
    [sc.OpCode.SIGN]: {},
    [sc.OpCode.ABS]: {},
    [sc.OpCode.NEGATE]: {},
    [sc.OpCode.INC]: {},
    [sc.OpCode.DEC]: {},
    [sc.OpCode.ADD]: {},
    [sc.OpCode.SUB]: {},
    [sc.OpCode.MUL]: {},
    [sc.OpCode.DIV]: {},
    [sc.OpCode.MOD]: {},
    [sc.OpCode.POW]: {},
    [sc.OpCode.SQRT]: {},
    [sc.OpCode.SHL]: {},
    [sc.OpCode.SHR]: {},
    [sc.OpCode.NOT]: {},
    [sc.OpCode.BOOLAND]: {},
    [sc.OpCode.BOOLOR]: {},
    [sc.OpCode.NZ]: {},
    [sc.OpCode.NUMEQUAL]: {},
    [sc.OpCode.NUMNOTEQUAL]: {},
    [sc.OpCode.LT]: {},
    [sc.OpCode.LE]: {},
    [sc.OpCode.GT]: {},
    [sc.OpCode.GE]: {},
    [sc.OpCode.MIN]: {},
    [sc.OpCode.MAX]: {},
    [sc.OpCode.WITHIN]: {},
    [sc.OpCode.PACKMAP]: {},
    [sc.OpCode.PACKSTRUCT]: {},
    [sc.OpCode.PACK]: {},
    [sc.OpCode.UNPACK]: {},
    [sc.OpCode.NEWARRAY0]: {},
    [sc.OpCode.NEWARRAY]: {},
    [sc.OpCode.NEWARRAY_T]: { operandSize: 1 },
    [sc.OpCode.NEWSTRUCT0]: {},
    [sc.OpCode.NEWSTRUCT]: {},
    [sc.OpCode.NEWMAP]: {},
    [sc.OpCode.SIZE]: {},
    [sc.OpCode.HASKEY]: {},
    [sc.OpCode.KEYS]: {},
    [sc.OpCode.VALUES]: {},
    [sc.OpCode.PICKITEM]: {},
    [sc.OpCode.APPEND]: {},
    [sc.OpCode.SETITEM]: {},
    [sc.OpCode.REVERSEITEMS]: {},
    [sc.OpCode.REMOVE]: {},
    [sc.OpCode.CLEARITEMS]: {},
    [sc.OpCode.POPITEM]: {},
    [sc.OpCode.ISNULL]: {},
    [sc.OpCode.ISTYPE]: { operandSize: 1 },
    [sc.OpCode.CONVERT]: { operandSize: 1 },
};
/* spell-checker: enable */
