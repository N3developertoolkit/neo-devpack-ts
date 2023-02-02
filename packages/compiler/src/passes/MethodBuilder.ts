import { OpCode } from "@cityofzion/neon-core/lib/sc";
import * as tsm from "ts-morph";
import { JumpOperation, LoadStoreOperation, LoadStoreOperationKind, Operation, OperationKind, PushBoolOperation, PushDataOperation, PushIntOperation } from "../types/Operation";
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
        if (!Number.isInteger(paramCount)) {
            throw new Error(`Invalid param count ${paramCount}`);
        }
    }

    getOperations(): ReadonlyArray<Operation> {
        // TODO: process jump targets
        return this._operations;
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

    operation(kind: OperationKind, location?: tsm.Node): void {
        var op: Operation = { kind, location };
        this._operations.push(op);
    }

    pushBoolean(value: boolean, location?: tsm.Node): void {
        const op: PushBoolOperation = { kind: 'pushbool', value, location };
        this._operations.push(op);
    }

    pushInt(value: bigint, location?: tsm.Node): void {
        const op: PushIntOperation = { kind: 'pushint', value, location };
        this._operations.push(op);
    }

    pushData(value: ReadonlyUint8Array, location?: tsm.Node) {
        const op: PushDataOperation = { kind: 'pushdata', value, location };
        this._operations.push(op);
    }

    pushNull(location?: tsm.Node) {
        const op: Operation = { kind: 'pushnull', location };
        this._operations.push(op);
    }

    jump(target: TargetOffset, location?: tsm.Node): void {
        const op: JumpOperation = { kind: 'jump', offset: 0, location };
        this._operations.push(op);
        this._jumps.set(op, target);
    }

    load(kind: LoadStoreKind, index: number, location?: tsm.Node): void {
        if (!Number.isInteger(index)) throw new Error(`Invalid load index ${index}`);
        const opKind = kind === 'arg' 
            ? "loadarg"
            : kind === 'local' ? 'loadlocal' : 'loadstatic';
            const op: LoadStoreOperation = { kind: opKind, index, location };
            this._operations.push(op);
    }

    store(kind: LoadStoreKind, index: number, location?: tsm.Node): void {
        if (!Number.isInteger(index)) throw new Error(`Invalid store index ${index}`);
        const opKind = kind === 'arg' 
            ? "storearg"
            : kind === 'local' ? 'storelocal' : 'storestatic';
        const op: LoadStoreOperation = { kind: opKind, index, location };
        this._operations.push(op);
    }
}
