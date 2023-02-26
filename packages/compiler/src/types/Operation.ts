import * as tsm from "ts-morph";
import { ReadonlyUint8Array } from '../utility/ReadonlyArrays';
import { sc } from '@cityofzion/neon-core';

export type Location = tsm.Node | { start: tsm.Node, end: tsm.Node };

export const simpleOperationKinds = [
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

const loadStoreOperationKinds = [
    'loadarg',
    'loadlocal',
    'loadstatic',
    'storearg',
    'storelocal',
    'storestatic'
] as const;

export type LoadStoreOperationKind = typeof loadStoreOperationKinds[number];

export type Operation =
    CallOperation |
    CallTokenOperation |
    ConvertOperation |
    InitSlotOperation |
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

export interface ConvertOperation {
    readonly kind: 'convert',
    readonly type: sc.StackItemType
    location?: Location,
}

export interface SysCallOperation {
    readonly kind: 'syscall',
    readonly name: string
    location?: Location,
}

export interface CallTokenOperation {
    readonly kind: 'calltoken',
    readonly token: sc.MethodToken
    location?: Location,
}

export interface CallOperation {
    readonly kind: 'call',
    // readonly method: MethodSymbolDef,
    location?: Location,
}

export interface InitSlotOperation {
    readonly kind: 'initslot',
    readonly locals: number,
    readonly params: number
    location?: Location,
}

export interface PushDataOperation {
    readonly kind: 'pushdata';
    readonly value: ReadonlyUint8Array
    location?: Location,
}

export interface PushIntOperation {
    readonly kind: 'pushint';
    readonly value: bigint;
    location?: Location,
}

export const isPushInt = (op: Operation): op is PushIntOperation => op.kind === 'pushint';

export interface PushBoolOperation {
    readonly kind: 'pushbool';
    readonly value: boolean;
    location?: Location,
}

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

export function isJumpOffsetOperation(op: Operation): op is JumpOffsetOperation {
    return jumpOperationKinds.includes(op.kind as JumpOperationKind)
        && 'offset' in op
        && typeof op.offset === 'number';
}

export function isJumpTargetOperation(op: Operation): op is JumpTargetOperation {
    return jumpOperationKinds.includes(op.kind as JumpOperationKind)
        && 'target' in op
        && typeof op.target === 'object';
}

export interface LoadStoreOperation {
    readonly kind: LoadStoreOperationKind
    readonly index: number
    location?: Location,
}






export function parseOperation(kind: string, operand: string | undefined): Operation | undefined {
    if (jumpOperationKinds.includes(kind as JumpOperationKind)) {
        if (!operand) throw new Error(`${kind} missing jump offset operand`);
        const op: JumpOffsetOperation = { kind: kind as JumpOperationKind, offset: parseInt(operand) }
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

