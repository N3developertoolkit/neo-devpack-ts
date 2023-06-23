import * as tsm from "ts-morph";
import { sc, CONST } from '@cityofzion/neon-core';
import { convertBigInteger, isBigIntLike, isBooleanLike, isNumberLike, isStringLike } from "../utils";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';

export type Location = tsm.Node | { start: tsm.Node, end: tsm.Node };

export const updateLocation =
    (location: Location) =>
        (ops: readonly Operation[]) =>
            ROA.isNonEmpty(ops)
                ? pipe(ops, RNEA.modifyHead(op => ({ ...op, location })))
                : ops;

export const simpleOperationKinds = [

    // constants 
    'pushnull',

    // flow control
    'noop',
    'throw',
    'return',
    'endfinally',

    // Stack Management
    'drop',
    'duplicate',
    'rotate',

    // splice
    'concat',

    // bitwise logic
    'invert',
    'and',
    'or',
    'xor',
    'equal',
    'notequal',

    // Arithmetic
    'negate',
    'increment',
    'decrement',
    'add',
    'subtract',
    'multiply',
    'divide',
    'modulo',
    'power',
    'shiftleft',
    'shiftright',
    'not',
    'numequal',
    'lessthan',
    'lessthanorequal',
    'greaterthan',
    'greaterthanorequal',

    // Compound-type
    'packmap',
    'packstruct',
    'packarray',
    'newemptyarray',
    'newemptymap',
    'size',
    'haskey',
    'pickitem',
    'append',
    'setitem',
    'removeitem',
    'clearitems',

    // types
    'isnull',
] as const;

export type SimpleOperationKind = typeof simpleOperationKinds[number];

export function convertSimpleOperationKind(kind: SimpleOperationKind) {
    switch (kind) {
        case 'and': return sc.OpCode.AND;
        case "add": return sc.OpCode.ADD;
        case "append": return sc.OpCode.APPEND;
        case "concat": return sc.OpCode.CAT;
        case "clearitems": return sc.OpCode.CLEARITEMS;
        case "drop": return sc.OpCode.DROP;
        case "duplicate": return sc.OpCode.DUP;
        case 'endfinally': return sc.OpCode.ENDFINALLY;
        case "equal": return sc.OpCode.EQUAL;
        case "greaterthan": return sc.OpCode.GT;
        case "greaterthanorequal": return sc.OpCode.GE;
        case "isnull": return sc.OpCode.ISNULL;
        case "lessthan": return sc.OpCode.LT;
        case "lessthanorequal": return sc.OpCode.LE;
        case "multiply": return sc.OpCode.MUL;
        case "negate": return sc.OpCode.NEGATE;
        case "newemptyarray": return sc.OpCode.NEWARRAY0;
        case "newemptymap": return sc.OpCode.NEWMAP;
        case "noop": return sc.OpCode.NOP;
        case "not": return sc.OpCode.NOT;
        case "notequal": return sc.OpCode.NOTEQUAL;
        case "numequal": return sc.OpCode.NUMEQUAL;
        case "or": return sc.OpCode.OR;
        case "packarray": return sc.OpCode.PACK;
        case "packmap": return sc.OpCode.PACKMAP;
        case "packstruct": return sc.OpCode.PACKSTRUCT;
        case "pickitem": return sc.OpCode.PICKITEM;
        case "power": return sc.OpCode.POW;
        case "pushnull": return sc.OpCode.PUSHNULL;
        case "return": return sc.OpCode.RET;
        case "removeitem": return sc.OpCode.REMOVE;
        case "rotate": return sc.OpCode.ROT;
        case "setitem": return sc.OpCode.SETITEM;
        case 'size': return sc.OpCode.SIZE;
        case "subtract": return sc.OpCode.SUB;
        case "throw": return sc.OpCode.THROW;
    }

    throw new Error(`${kind} operation not implemented`)
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
    EndTryOffsetOperation |
    EndTryTargetOperation |
    InitSlotOperation |
    InitStaticOperation |
    JumpOffsetOperation |
    JumpTargetOperation |
    LoadStoreOperation |
    PushBoolOperation |
    PushDataOperation |
    PushIntOperation |
    SimpleOperation |
    SysCallOperation |
    TryOffsetOperation |
    TryTargetOperation;

export interface SimpleOperation {
    readonly kind: SimpleOperationKind,
    readonly location?: Location,
}

export const isSimpleOp = (op: Operation): op is SimpleOperation =>
    simpleOperationKinds.includes(op.kind as SimpleOperationKind);

export interface ConvertOperation {
    readonly kind: 'convert',
    readonly type: sc.StackItemType
    readonly location?: Location,
}

export const isConvertOp = (op: Operation): op is ConvertOperation => op.kind === 'convert';

export interface SysCallOperation {
    readonly kind: 'syscall',
    readonly name: string
    readonly location?: Location,
}

export const isSysCallOp = (op: Operation): op is SysCallOperation => op.kind === 'syscall';

export interface CallTokenOperation {
    readonly kind: 'calltoken',
    readonly token: sc.MethodToken
    readonly location?: Location,
}

export const isCallTokenOp = (op: Operation): op is CallTokenOperation => op.kind === 'calltoken';

export interface CallOperation {
    readonly kind: 'call',
    readonly method: tsm.Symbol,
    readonly location?: Location,
}

export const isCallOp = (op: Operation): op is CallOperation => op.kind === 'call';

export interface InitSlotOperation {
    readonly kind: 'initslot',
    readonly locals: number,
    readonly params: number
    readonly location?: Location,
}

export const isInitSlotOp = (op: Operation): op is InitSlotOperation => op.kind === 'initslot';

export interface InitStaticOperation {
    readonly kind: 'initstatic',
    readonly count: number,
    readonly location?: Location,
}

export const isInitStaticOperation = (op: Operation): op is InitStaticOperation => op.kind === 'initstatic';

export interface PushDataOperation {
    readonly kind: 'pushdata';
    readonly value: Uint8Array
    readonly location?: Location,
}

export const isPushDataOp = (op: Operation): op is PushDataOperation => op.kind === 'pushdata';

export function pushString(value: string, location?: Location): PushDataOperation {
    const op = { kind: 'pushdata', value: Buffer.from(value, 'utf8') } as PushDataOperation;
    return location ? { ...op, location } : op;
}

export interface PushIntOperation {
    readonly kind: 'pushint';
    readonly value: bigint;
    readonly location?: Location,
}

export const isPushIntOp = (op: Operation): op is PushIntOperation => op.kind === 'pushint';

export function pushInt(value: number | bigint, location?: Location): PushIntOperation {
    value = typeof value === 'number' ? BigInt(value) : value;
    const op = { kind: 'pushint', value } as PushIntOperation;
    return location ? { ...op, location } : op;
}

export interface PushBoolOperation {
    readonly kind: 'pushbool';
    readonly value: boolean;
    readonly location?: Location,
}

export const isPushBoolOp = (op: Operation): op is PushBoolOperation => op.kind === 'pushbool';

// during function parsing, it's typically easier to specify the jump target
// via the target operation instead of via the index offset. However,
// @operation functions require specifying the index offset. 

export interface JumpOffsetOperation {
    readonly kind: JumpOperationKind;
    readonly offset: number;
    readonly location?: Location,
}

export interface JumpTargetOperation {
    readonly kind: JumpOperationKind;
    readonly target: Operation;
    readonly location?: Location,
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

export interface TryOffsetOperation {
    readonly kind: 'try';
    readonly catchOffset: number | undefined;
    readonly finallyOffset: number | undefined;
    readonly location?: Location;
}

export interface TryTargetOperation {
    readonly kind: 'try';
    readonly catchTarget: Operation | undefined;
    readonly finallyTarget: Operation | undefined;
    readonly location?: Location;
}

export function isTryOffsetOp(op: Operation): op is TryOffsetOperation {
    return op.kind === 'try'
        && 'catchOffset' in op
        && 'finallyOffset' in op;
}

export function isTryTargetOp(op: Operation): op is TryTargetOperation {
    return op.kind === 'try'
        && 'catchTarget' in op
        && 'finallyTarget' in op;
}

export interface EndTryOffsetOperation {
    readonly kind: 'endtry';
    readonly offset: number;
    readonly location?: Location;
}

export interface EndTryTargetOperation {
    readonly kind: 'endtry';
    readonly target: Operation;
    readonly location?: Location;
}

export function isEndTryOffsetOp(op: Operation): op is EndTryOffsetOperation {
    return op.kind === 'endtry'
        && 'offset' in op
        && typeof op.offset === 'number';
}

export function isEndTryTargetOp(op: Operation): op is EndTryTargetOperation {
    return op.kind === 'endtry'
        && 'target' in op
        && typeof op.target === 'object';
}

export interface LoadStoreOperation {
    readonly kind: LoadStoreOperationKind
    readonly index: number
    readonly location?: Location,
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
        case 'try':
            return 9;
        case 'endtry':
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
            return pushDataOpSize(value);
        }
        case 'pushint': {
            const { value } = op as PushIntOperation;
            return pushIntOpSize(value);
        }
        default:
            throw new Error(`getOperationSize ${(op as any).kind}`);
    }
}

function pushDataOpSize(value: Uint8Array) {
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

function pushIntOpSize(value: number | bigint) {
    value = typeof value === "number" ? BigInt(value) : value;

    if (value <= 16n && value >= -1n) return 1;

    const { buffer } = convertBigInteger(value);
    return 1 + buffer.length;
}

export const convertTargetOps =
    (ops: readonly Operation[]) => {

        function convertTarget(target: Operation) {
            return pipe(ops, ROA.findIndex(o => target === o), E.fromOption(() => "failed to locate target index"))
        }
        return pipe(
            ops,
            ROA.mapWithIndex((index, op) => {
                return pipe(
                    op,
                    op => {
                        if (isJumpTargetOp(op) || isEndTryTargetOp(op)) {
                            return pipe(
                                convertTarget(op.target),
                                E.map(targetIndex => {
                                    return <Operation>{
                                        kind: op.kind,
                                        offset: targetIndex - index,
                                        location: op.location
                                    }                 
                                })
                            )
                        } else if (isTryTargetOp(op)) {
                            return pipe(
                                E.Do,
                                E.bind("catchOffset", () => op.catchTarget ? convertTarget(op.catchTarget) : E.of(undefined)),
                                E.bind("finallyOffset", () => op.finallyTarget ? convertTarget(op.finallyTarget) : E.of(undefined)),
                                E.map(({ catchOffset, finallyOffset }) => {
                                    return <Operation>{
                                        kind: op.kind,
                                        catchOffset,
                                        finallyOffset, 
                                        location: op.location
                                    }
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

export const convertOffsetOps =
    (ops: readonly Operation[]) => {
        function convertOffset(index: number, offset: number) {
            return pipe(ops, ROA.lookup(index + offset), E.fromOption(() => "failed to locate target offset"))
        }
        return pipe(
            ops,
            ROA.mapWithIndex((index, op) => {
                return pipe(
                    op,
                    op => {
                        if (isJumpOffsetOp(op) || isEndTryOffsetOp(op)) {
                            return pipe(
                                convertOffset(index, op.offset),
                                E.map(target => {
                                    return <Operation>{
                                        kind: op.kind,
                                        target,
                                        location: op.location
                                    }
                                })
                            )
                        } else if (isTryOffsetOp(op)) {
                            return pipe(
                                E.Do,
                                E.bind("catchTarget", () => op.catchOffset ? convertOffset(index, op.catchOffset) : E.of(undefined)),
                                E.bind("finallyTarget", () => op.finallyOffset ? convertOffset(index, op.finallyOffset) : E.of(undefined)),
                                E.map(({ catchTarget, finallyTarget }) => {
                                    return <Operation>{
                                        kind: op.kind,
                                        catchTarget,
                                        finallyTarget,
                                        location: op.location
                                    }
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

export function getIntegerConvertOps(type: tsm.Type): readonly Operation[] {
    if (isBigIntLike(type) || isNumberLike(type)) return [];
    if (isBooleanLike(type)) {
        return [
            { kind: 'jumpifnot', offset: 3 },
            pushInt(0),
            { kind: "jump", offset: 2 },
            pushInt(1),
            { kind: 'noop' }
        ];
    }
    if (isStringLike(type)) {
        const token = new sc.MethodToken({ hash: CONST.NATIVE_CONTRACT_HASH.StdLib, method: "atoi", hasReturnValue: true, parametersCount: 1 })
        return [{ kind: 'calltoken', token }]
    }
    return [{ kind: "convert", type: sc.StackItemType.Integer }];
}

export function getStringConvertOps(type: tsm.Type): readonly Operation[] {

    if (isStringLike(type)) return [];
    if (isBooleanLike(type)) {
        return [
            { kind: 'jumpifnot', offset: 3 },
            pushString('true'),
            { kind: "jump", offset: 2 },
            pushString('false'),
            { kind: 'noop' }
        ];
    }
    if (isBigIntLike(type) || isNumberLike(type)) {
        return [
            {
                kind: "calltoken", token: new sc.MethodToken({
                    hash: CONST.NATIVE_CONTRACT_HASH.StdLib,
                    method: "Itoa",
                    hasReturnValue: true,
                    parametersCount: 1,
                })
            }
        ];
    }

    const typeName = type.getSymbol()?.getName();
    if (typeName === "ByteString") return [];

    // The convert operation costs 1 << 13, making it one of the most expensive operations. 
    // Fallback to convert only if there's not a type specific conversion available.
    return [{ kind: "convert", type: sc.StackItemType.ByteString }];
}

export function getBooleanConvertOps(type: tsm.Type): readonly Operation[] {

    // boolean experessions don't need to be converted
    if (isBooleanLike(type)) return [];

    // numeric expressions are converted by comparing value to zero
    if (isBigIntLike(type) || isNumberLike(type)) {
        [
            { kind: 'pushint', value: 0n },
            { kind: 'equal' },
        ] as readonly Operation[];
    }

    // convert ByteString to boolean by comparing to null and comparing length to zero
    // this set of operations is much cheaper than a single convert operation
    const byteStringToBooleanConvertOps = [
        { kind: 'duplicate' },
        { kind: 'isnull' },
        { kind: "jumpifnot", offset: 4 },
        { kind: 'drop' },
        { kind: 'pushbool', value: false },
        { kind: "jump", offset: 4 },
        { kind: 'size' },
        { kind: 'pushint', value: 0n },
        { kind: 'notequal' },
        { kind: 'noop' }
    ] as readonly Operation[];

    if (isStringLike(type)) return byteStringToBooleanConvertOps;

    const typeName = type.getSymbol()?.getName();
    if (typeName === "ByteString") return byteStringToBooleanConvertOps;

    // objects are converted by checking against null
    if (type.isObject()) {
        return [
            { kind: 'isnull' },
            { kind: "not" },
        ];
    }

    // The convert operation costs 1 << 13, making it one of the most expensive operations. 
    // Fallback to convert only if there's not a type specific conversion available.
    return [{ kind: "convert", type: sc.StackItemType.Boolean }];
}

export function makeConditionalExpression({ condition, whenTrue, whenFalse }: {
    condition: readonly Operation[];
    whenTrue: readonly Operation[];
    whenFalse: readonly Operation[];
}): readonly Operation[] {

    const falseTarget: Operation = { kind: "noop" };
    const endTarget: Operation = { kind: "noop" };
    return pipe(
        condition,
        ROA.append({ kind: 'jumpifnot', target: falseTarget } as Operation),
        ROA.concat(whenTrue),
        ROA.append({ kind: 'jump', target: endTarget } as Operation),
        ROA.append(falseTarget as Operation),
        ROA.concat(whenFalse),
        ROA.append(endTarget as Operation)
    );
}
