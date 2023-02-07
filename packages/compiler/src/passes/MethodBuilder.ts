import * as tsm from "ts-morph";
import { InitSlotOperation, JumpOperation, LoadStoreOperation, LoadStoreOperationKind, Operation, OperationKind, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation } from "../types/Operation";
import { ReadonlyUint8Array } from "../utility/ReadonlyArrays";

export interface TargetOffset {
    operation: Operation | undefined
}


export type LoadStoreKind = 'arg' | 'local' | 'static';

export class MethodBuilder {
    private readonly _operations = new Array<Operation>();
    private readonly _returnTarget: TargetOffset = { operation: undefined };
    private readonly _jumps = new Map<JumpOperation, TargetOffset>();
    private readonly _locals = new Array<tsm.VariableDeclaration>();

    constructor(readonly paramCount: number) {
        if (!Number.isInteger(paramCount) || paramCount < 0) {
            throw new Error(`Invalid param count ${paramCount}`);
        }
    }

    getVariables() {
        return this._locals.map(v => ({
            name: v.getName(),
            type: v.getType(),
        }));
    }

    getOperations(): ReadonlyArray<Operation> {
        // make a copy of the builder's operation
        const operations = [...this._operations];

        // push a initslot operation at the start if needed
        const locals = this._locals.length;
        if (this.paramCount > 0 || locals > 0) {
            const op: InitSlotOperation = { kind: "initslot", locals, params: this.paramCount };
            operations.unshift(op);
        }

        // push a return operation at end
        const returnOp: Operation = { kind: 'return' }
        const returnIndex = operations.push(returnOp) - 1;

        // process jump targets (1st draft)
        for (const [jump, target] of this._jumps) {
            const jumpIndex = operations.indexOf(jump);
            if (jumpIndex < 0) throw new Error("failed to locate operation index");
            const targetIndex = target === this._returnTarget ? returnIndex : -1;
            if (targetIndex < 0) throw new Error("failed to locate target index");
            operations[jumpIndex] = {
                kind: jump.kind,
                offset: targetIndex - jumpIndex,
                location: jump.location
            } as JumpOperation;
        }

        return operations;
    }

    get returnTarget(): Readonly<TargetOffset> { return this._returnTarget; }

    getLocationSetter(): (node?: tsm.Node) => void {
        const length = this._operations.length;
        return (node?) => {
            if (node && length < this._operations.length) {
                this._operations[length].location = node;
            }
        };
    }

    addLocal(node: tsm.VariableDeclaration) {
        const length = this._locals.push(node);
        return length - 1;
    }

    emitOperation(kind: OperationKind, location?: tsm.Node): void {
        var op: Operation = { kind, location };
        this._operations.push(op);
    }

    emitPushBoolean(value: boolean, location?: tsm.Node): void {
        const op: PushBoolOperation = { kind: 'pushbool', value, location };
        this._operations.push(op);
    }

    emitPushInt(value: bigint, location?: tsm.Node): void {
        const op: PushIntOperation = { kind: 'pushint', value, location };
        this._operations.push(op);
    }

    emitPushData(value: ReadonlyUint8Array, location?: tsm.Node) {
        const op: PushDataOperation = { kind: 'pushdata', value, location };
        this._operations.push(op);
    }

    emitPushNull(location?: tsm.Node) {
        const op: Operation = { kind: 'pushnull', location };
        this._operations.push(op);
    }

    emitJump(target: TargetOffset, location?: tsm.Node): void {
        const op: JumpOperation = { kind: 'jump', offset: 0, location };
        this._jumps.set(op, target);
        this._operations.push(op);
    }

    emitLoad(kind: LoadStoreKind, index: number, location?: tsm.Node): void {
        if (!Number.isInteger(index)) throw new Error(`Invalid load index ${index}`);
        const opKind = kind === 'arg'
            ? "loadarg"
            : kind === 'local' ? 'loadlocal' : 'loadstatic';
        const op: LoadStoreOperation = { kind: opKind, index, location };
        this._operations.push(op);
    }

    emitStore(kind: LoadStoreKind, index: number, location?: tsm.Node): void {
        if (!Number.isInteger(index)) throw new Error(`Invalid store index ${index}`);
        const opKind = kind === 'arg'
            ? "storearg"
            : kind === 'local' ? 'storelocal' : 'storestatic';
        const op: LoadStoreOperation = { kind: opKind, index, location };
        this._operations.push(op);
    }

    emitSysCall(name: string, location?: tsm.Node): void {
        const op: SysCallOperation = { kind: 'syscall', name, location };
        this._operations.push(op);
    }
}
