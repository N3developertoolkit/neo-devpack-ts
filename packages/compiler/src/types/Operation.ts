import * as tsm from "ts-morph";
import { sc } from '@cityofzion/neon-core';
import { convertBigInteger } from "../utils";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";

export type Location = tsm.Node | { start: tsm.Node, end: tsm.Node };

export const simpleOperationKinds = [
    'and',
    'add',
    'append',
    'concat',
    'drop',
    'duplicate',
    'equal',
    'greaterthan',
    'greaterthanorequal',
    'isnull',
    'lessthan',
    'lessthanorequal',
    'multiply',
    'negate',
    'newemptyarray',
    'noop',
    'not',
    'notequal',
    'pack',
    'pickitem',
    'power',
    'pushnull',
    'return',
    'subtract',
    'throw'
] as const;

export type SimpleOperationKind = typeof simpleOperationKinds[number];

export function convertSimpleOperationKind(kind: SimpleOperationKind) {
    switch (kind) {
        case 'and': return sc.OpCode.AND;
        case "add": return sc.OpCode.ADD;
        case "append": return sc.OpCode.APPEND;
        case "concat": return sc.OpCode.CAT;
        case "drop": return sc.OpCode.DROP;
        case "duplicate": return sc.OpCode.DUP;
        case "equal": return sc.OpCode.EQUAL;
        case "greaterthan": return sc.OpCode.GT;
        case "greaterthanorequal": return sc.OpCode.GE;
        case "isnull": return sc.OpCode.ISNULL;
        case "lessthan": return sc.OpCode.LT;
        case "lessthanorequal": return sc.OpCode.LE;
        case "multiply": return sc.OpCode.MUL;
        case "negate": return sc.OpCode.NEGATE;
        case "newemptyarray": return sc.OpCode.NEWARRAY0;
        case "noop": return sc.OpCode.NOP;
        case "not": return sc.OpCode.NOT;
        case "notequal": return sc.OpCode.NOTEQUAL;
        case "pack": return sc.OpCode.PACK;
        case "pickitem": return sc.OpCode.PICKITEM;
        case "power": return sc.OpCode.POW;
        case "pushnull": return sc.OpCode.PUSHNULL;
        case "return": return sc.OpCode.RET;
        case "subtract": return sc.OpCode.SUB;
        case "throw": return sc.OpCode.THROW;
    }
}

const jumpOperationKinds = [
    'jump',
    'jumpeq',
    'jumpge',
    'jumpgt',
    'jumpif',
    'jumpifnot',
    'jumple',
    'jumplt',
    'jumpne',
] as const;

export type JumpOperationKind = typeof jumpOperationKinds[number];

export function convertJumpOperationKind(kind: JumpOperationKind) {
    switch (kind) {
        case "jump": return sc.OpCode.JMP_L;
        case "jumpeq": return sc.OpCode.JMPEQ_L;
        case "jumpge": return sc.OpCode.JMPGE_L;
        case "jumpgt": return sc.OpCode.JMPGT_L;
        case "jumpif": return sc.OpCode.JMPIF_L;
        case "jumpifnot": return sc.OpCode.JMPIFNOT_L;
        case "jumple": return sc.OpCode.JMPLE_L;
        case "jumplt": return sc.OpCode.JMPLT_L;
        case "jumpne": return sc.OpCode.JMPNE_L;
    }
}

const loadStoreOperationKinds = [
    'loadarg',
    'loadlocal',
    'loadstatic',
    'storearg',
    'storelocal',
    'storestatic'
] as const;

export type LoadStoreOperationKind = typeof loadStoreOperationKinds[number];


export function convertLoadStoreKind(kind: LoadStoreOperationKind) {
    switch (kind) {
        case "loadarg": return sc.OpCode.LDARG;
        case "loadlocal": return sc.OpCode.LDLOC;
        case "loadstatic": return sc.OpCode.LDSFLD;
        case "storearg": return sc.OpCode.STARG;
        case "storelocal": return sc.OpCode.STLOC;
        case "storestatic": return sc.OpCode.STSFLD;
    }
}

export type Operation =
    CallOperation |
    CallTokenOperation |
    ConvertOperation |
    InitSlotOperation |
    InitStaticOperation |
    JumpOffsetOperation |
    JumpTargetOperation |
    LoadStoreOperation |
    PushBoolOperation |
    PushDataOperation |
    PushIntOperation |
    SimpleOperation |
    SysCallOperation;

export interface SimpleOperation {
    readonly kind: SimpleOperationKind,
    location?: Location,
}

export const isSimpleOp = (op: Operation): op is SimpleOperation => 
    simpleOperationKinds.includes(op.kind as SimpleOperationKind);

export interface ConvertOperation {
    readonly kind: 'convert',
    readonly type: sc.StackItemType
    location?: Location,
}

export const isConvertOp = (op: Operation): op is ConvertOperation => op.kind === 'convert';

export interface SysCallOperation {
    readonly kind: 'syscall',
    readonly name: string
    location?: Location,
}

export const isSysCallOp = (op: Operation): op is SysCallOperation => op.kind === 'syscall';

export interface CallTokenOperation {
    readonly kind: 'calltoken',
    readonly token: sc.MethodToken
    location?: Location,
}

export const isCallTokenOp = (op: Operation): op is CallTokenOperation => op.kind === 'calltoken';

export interface CallOperation {
    readonly kind: 'call',
    readonly method: tsm.Symbol,
    location?: Location,
}

export const isCallOp = (op: Operation): op is CallOperation => op.kind === 'call';

export interface InitSlotOperation {
    readonly kind: 'initslot',
    readonly locals: number,
    readonly params: number
    location?: Location,
}

export const isInitSlotOp = (op: Operation): op is InitSlotOperation => op.kind === 'initslot';

export interface InitStaticOperation {
    readonly kind: 'initstatic',
    readonly count: number,
    location?: Location,
}

export const isInitStaticOperation = (op: Operation): op is InitStaticOperation => op.kind === 'initstatic';


export interface PushDataOperation {
    readonly kind: 'pushdata';
    readonly value: Uint8Array
    location?: Location,
}

export const isPushDataOp = (op: Operation): op is PushDataOperation => op.kind === 'pushdata';

export interface PushIntOperation {
    readonly kind: 'pushint';
    readonly value: bigint;
    location?: Location,
}

export const isPushIntOp = (op: Operation): op is PushIntOperation => op.kind === 'pushint';

export interface PushBoolOperation {
    readonly kind: 'pushbool';
    readonly value: boolean;
    location?: Location,
}

export const isPushBoolOp = (op: Operation): op is PushBoolOperation => op.kind === 'pushbool';


// during function parsing, it's typically easier to specify the jump target
// via the target operation instead of via the index offset. However,
// @operation functions require specifying the index offset. 

export interface JumpOffsetOperation {
    readonly kind: JumpOperationKind;
    readonly offset: number;
    location?: Location,
}

export interface JumpTargetOperation {
    readonly kind: JumpOperationKind;
    readonly target: Operation;
    location?: Location,
}

export function isJumpOffsetOp(op: Operation): op is JumpOffsetOperation {
    return jumpOperationKinds.includes(op.kind as JumpOperationKind)
        && 'offset' in op
        && typeof op.offset === 'number';
}

export function isJumpTargetOp(op: Operation): op is JumpTargetOperation {
    return jumpOperationKinds.includes(op.kind as JumpOperationKind)
        && 'target' in op
        && typeof op.target === 'object';
}

export interface LoadStoreOperation {
    readonly kind: LoadStoreOperationKind
    readonly index: number
    location?: Location,
}

export const isLoadStoreOp = (op: Operation): op is LoadStoreOperation => 
    loadStoreOperationKinds.includes(op.kind as LoadStoreOperationKind);


export function parseOperation(kind: string, operand: string | undefined): Operation | undefined {
    if (jumpOperationKinds.includes(kind as JumpOperationKind)) {
        if (!operand) throw new Error(`${kind} missing jump offset operand`);
        const op: JumpOffsetOperation = { kind: kind as JumpOperationKind, offset: parseInt(operand) }
        return op;
    }

    if (loadStoreOperationKinds.includes(kind as LoadStoreOperationKind)) {
        if (!operand) throw new Error(`${kind} missing load/store operand`);
        const op: LoadStoreOperation = { kind: kind as LoadStoreOperationKind, index: parseInt(operand) }
        return op;
    }

    if (simpleOperationKinds.includes(kind as SimpleOperationKind) && !operand) {
        return { kind: kind as SimpleOperationKind };
    }

    switch (kind) {
        case 'convert': {
            if (!operand) throw new Error(`${kind} missing operand`);
            const type = sc.StackItemType[operand as keyof typeof sc.StackItemType];
            if (!type) throw new Error(`${kind} invalid operand ${operand}`);
            return { kind, type };
        }
        case 'pushbool': {
            if (!operand) throw new Error(`${kind} missing operand`);
            return { kind, value: operand == 'true' };
        }
        case 'pushdata': {
            if (!operand) throw new Error(`${kind} missing operand`);
            throw new Error(`${kind} not implemented`);
        }
        case 'pushint': {
            if (!operand) throw new Error(`${kind} missing operand`);
            return { kind, value: BigInt(operand) };
        }
        case 'syscall': {
            if (!operand) throw new Error(`${kind} missing operand`);
            return { kind, name: operand };
        }
    }
}

export function getOperationSize(op: Operation) {
    if (isSimpleOp(op)) return 1;
    switch (op.kind) {
        case "pushbool":
            return 1;
        case 'convert':
        case 'initstatic':
            return 2;
        case 'calltoken':
        case 'initslot':
            return 3;
        case 'call':
        case 'jump':
        case 'jumpif':
        case 'jumpifnot':
        case 'jumpeq':
        case "jumpne":
        case "jumpgt":
        case "jumpge":
        case "jumplt":
        case "jumple":
        case 'syscall':
            return 5;
        case 'loadarg':
        case 'loadlocal':
        case 'loadstatic':
        case 'storearg':
        case 'storelocal':
        case 'storestatic': {
            const { index } = op as LoadStoreOperation
            return index <= 6 ? 1 : 2;
        }
        case 'pushdata': {
            const { value } = op as PushDataOperation;
            if (value.length <= 255) /* byte.MaxValue */ {
                return 2 + value.length;
            }
            if (value.length <= 65535) /* ushort.MaxValue */ {
                return 3 + value.length;
            }
            if (value.length <= 4294967295) /* uint.MaxValue */ {
                return 5 + value.length;
            }
            throw new Error(`pushData length ${value.length} too long`);
        }
        case 'pushint': {
            const { value } = op as PushIntOperation;
            if (value <= 16n && value >= -1n) return 1;

            const {buffer} = convertBigInteger(value);
            return 1 + buffer.length;
        }
        // default:
        //     throw new Error(`getOperationSize ${op.kind}`);
    }
}

export const convertJumpTargetOps =
    (ops: readonly Operation[]) => {
        return pipe(
            ops,
            ROA.mapWithIndex((index, op) => {
                return pipe(
                    op,
                    op => {
                        if (isJumpTargetOp(op)) {
                            return pipe(
                                ops,
                                ROA.findIndex(o => op.target === o),
                                E.fromOption(() => "failed to locate target index"),
                                E.map(targetIndex => {
                                    return {
                                        kind: op.kind,
                                        offset: targetIndex - index,
                                        location: op.location
                                    } as Operation
                                })
                            )
                        } else {
                            return E.of(op);
                        }
                    }
                )
            }),
            ROA.sequence(E.Applicative)
        )
    }

export const convertJumpOffsetOps =
    (ops: readonly Operation[]) => {
        return pipe(
            ops,
            ROA.mapWithIndex((index, op) => {
                return pipe(
                    op,
                    op => {
                        if (isJumpOffsetOp(op)) {
                            return pipe(
                                ops,
                                ROA.lookup(index + op.offset),
                                E.fromOption(() => "failed to locate target offset"),
                                E.map(target => {
                                    return {
                                        kind: op.kind,
                                        target,
                                        location: op.location
                                    } as Operation
                                })
                            )
                        } else {
                            return E.of(op);
                        }
                    }
                )
            }),
            ROA.sequence(E.Applicative)
        )
    }
