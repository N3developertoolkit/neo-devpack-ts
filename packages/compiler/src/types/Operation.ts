import * as tsm from "ts-morph";
import { ReadonlyUint8Array } from '../utility/ReadonlyArrays';
import { sc } from '@cityofzion/neon-core';

export const allowedOperations = [
    'add',
    'append',
    'call',
    'calltoken',
    'concat',
    'convert',
    'drop',
    'duplicate',
    'equal',
    'greaterthan',
    'greaterthanorequal',
    'initslot',
    'isnull',
    'jump',
    'jumpeq',
    'jumpge',
    'jumpgt',
    'jumpif',
    'jumpifnot',
    'jumple',
    'jumplt',
    'jumpne',
    'lessthan',
    'lessthanorequal',
    'loadarg',
    'loadlocal',
    'loadstatic',
    'multiply',
    'negate',
    'newemptyarray',
    'noop',
    'not',
    'notequal',
    'pack',
    'pickitem',
    'power',
    'pushbool',
    'pushdata',
    'pushint',
    'pushnull',
    'return',
    'storearg',
    'storelocal',
    'storestatic',
    'subtract',
    'syscall',
    'throw'] as const;

export type OperationKind = typeof allowedOperations[number];

export type Location = tsm.Node | { start: tsm.Node, end: tsm.Node };

export interface Operation {
    readonly kind: OperationKind,
    location?: Location,
}

export interface ConvertOperation {
    readonly kind: 'convert',
    readonly type: sc.StackItemType
}

export interface SysCallOperation extends Operation {
    readonly kind: 'syscall',
    readonly name: string
}

// export function isSysCallOperation(ins: Operation): ins is SysCallOperation {
//     return ins.kind === 'syscall';
// }

export interface CallTokenOperation extends Operation {
    readonly kind: 'calltoken',
    readonly token: sc.MethodToken
}

export interface CallOperation extends Operation {
    readonly kind: 'call',
    // readonly method: MethodSymbolDef,

}


export interface InitSlotOperation extends Operation {
    readonly kind: 'initslot',
    readonly locals: number,
    readonly params: number
}

// export function isInitSlotOperation(ins: Operation): ins is InitSlotOperation {
//     return ins.kind === 'initslot';
// }

export interface PushDataOperation extends Operation {
    readonly kind: 'pushdata';
    readonly value: ReadonlyUint8Array
}

// export function isPushDataOperation(ins: Operation): ins is PushDataOperation {
//     return ins.kind === 'pushdata';
// }

export interface PushIntOperation extends Operation {
    readonly kind: 'pushint';
    readonly value: bigint;
}

// export function isPushIntOperation(ins: Operation): ins is PushIntOperation {
//     return ins.kind === 'pushint';
// }

export interface PushBoolOperation extends Operation {
    readonly kind: 'pushbool';
    readonly value: boolean;
}

// export function isPushBoolOperation(ins: Operation): ins is PushBoolOperation {
//     return ins.kind === 'pushbool';
// }

const jumpOperationKinds = [
    'jump', 'jumpif', 'jumpifnot', 'jumpeq', 'jumpne', 'jumpgt', 'jumpge', 'jumplt', 'jumple'
] as const;

export type JumpOperationKind = typeof jumpOperationKinds[number];

export interface JumpOperation extends Operation {
    readonly kind: JumpOperationKind;
    readonly offset: number;
}

// export function isJumpOperation(ins: Operation): ins is JumpOperation {
//     return jumpOperationKinds.includes(ins.kind as JumpOperationKind);
// }

const loadStoreOperationKinds = [
    'loadarg', 'storearg', 'loadlocal', 'storelocal', 'loadstatic', 'storestatic'
] as const;

export type LoadStoreOperationKind = typeof loadStoreOperationKinds[number];

export interface LoadStoreOperation extends Operation {
    readonly kind: LoadStoreOperationKind
    readonly index: number
}

// export function isLoadStoreOperation(ins: Operation): ins is LoadStoreOperation {
//     return loadStoreOperationKinds.includes(ins.kind as LoadStoreOperationKind);
// }

export function parseOperation(kind: string, operand: string | undefined): Operation | undefined {
    if (jumpOperationKinds.includes(kind as JumpOperationKind)) {
        if (!operand) throw new Error(`${kind} missing jump offset operand`);
        return { kind: kind as JumpOperationKind, offset: parseInt(operand) } as JumpOperation;
    }

    switch (kind) {
        case 'convert': {
            if (!operand) throw new Error(`${kind} missing operand`);
            const type = sc.StackItemType[operand as keyof typeof sc.StackItemType];
            if (!type) throw new Error(`${kind} invalid operand ${operand}`);
            return { kind: 'convert', type } as ConvertOperation;
        }
        case 'pushint': {
            if (!operand) throw new Error(`${kind} missing operand`);
            return { kind: 'pushint', value: BigInt(operand)} as PushIntOperation;
        }
    }

    if (allowedOperations.includes(kind as OperationKind) && !operand) {
        return { kind: kind as OperationKind };
    }

    return undefined;
} 

