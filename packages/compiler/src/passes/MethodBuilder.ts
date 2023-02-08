import * as tsm from "ts-morph";
import { InitSlotOperation, JumpOperation, JumpOperationKind, LoadStoreOperation, LoadStoreOperationKind, Operation, OperationKind, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation } from "../types/Operation";
import { ReadonlyUint8Array } from "../utility/ReadonlyArrays";

export interface TargetOffset {
    operation: Operation | undefined
}


export type LoadStoreKind = 'arg' | 'local' | 'static';

type EmitReturn = {
    readonly operation: Operation;
    set(node?: tsm.Node): void;
};


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
            const targetIndex = target === this._returnTarget 
                ? returnIndex 
                : this._operations.indexOf(target.operation!);
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

    emit(op:Operation): EmitReturn;
    emit(kind: OperationKind, location?: tsm.Node): EmitReturn;
    emit(opOrKind: Operation | OperationKind, location?: tsm.Node): EmitReturn {
        const op = typeof opOrKind === 'object'
            ? opOrKind 
            : { kind: opOrKind, location };
        const index = this._operations.push(op) - 1;
        return {
            operation: op,
            set: (node?: tsm.Node) => {
                if (node) this._operations[index].location = node;
            }
        }
    }

    emitPushBoolean(value: boolean, location?: tsm.Node) {
        const op: PushBoolOperation = { kind: 'pushbool', value, location };
        return this.emit(op);
    }

    emitPushInt(value: bigint, location?: tsm.Node) {
        const op: PushIntOperation = { kind: 'pushint', value, location };
        return this.emit(op);
    }

    emitPushData(value: ReadonlyUint8Array, location?: tsm.Node) {
        const op: PushDataOperation = { kind: 'pushdata', value, location };
        return this.emit(op);
    }

    emitPushNull(location?: tsm.Node) {
        const op: Operation = { kind: 'pushnull', location };
        return this.emit(op);
    }

    emitJump(kind: JumpOperationKind, target: TargetOffset, location?: tsm.Node){
        const op: JumpOperation = { kind, offset: 0, location };
        this._jumps.set(op, target);
        return this.emit(op);
    }

    emitLoad(kind: LoadStoreKind, index: number, location?: tsm.Node) {
        if (!Number.isInteger(index)) throw new Error(`Invalid load index ${index}`);
        const opKind = kind === 'arg'
            ? "loadarg"
            : kind === 'local' ? 'loadlocal' : 'loadstatic';
        const op: LoadStoreOperation = { kind: opKind, index, location };
        return this.emit(op);
    }

    emitStore(kind: LoadStoreKind, index: number, location?: tsm.Node) {
        if (!Number.isInteger(index)) throw new Error(`Invalid store index ${index}`);
        const opKind = kind === 'arg'
            ? "storearg"
            : kind === 'local' ? 'storelocal' : 'storestatic';
        const op: LoadStoreOperation = { kind: opKind, index, location };
        return this.emit(op);
    }

    emitSysCall(name: string, location?: tsm.Node) {
        const op: SysCallOperation = { kind: 'syscall', name, location };
        return this.emit(op);
    }
}
