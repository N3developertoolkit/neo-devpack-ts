import * as tsm from "ts-morph";
import { Method } from "../types/DebugInfo";
import { JumpOperation, Operation, OperationKind, PushBoolOperation, PushDataOperation, PushIntOperation } from "../types/Operation";
import { ReadonlyUint8Array } from "../utility/ReadonlyArrays";

export interface TargetOffset {
    operation: Operation | undefined
}

export interface LocationSetter {
    set(node?: tsm.Node): void;
}

export class MethodBuilder {
    private readonly _operations = new Array<Operation>();
    private readonly _returnTarget: TargetOffset = { operation: undefined };
    private readonly _jumps = new Map<JumpOperation, TargetOffset>();

    get returnTarget(): Readonly<TargetOffset> { return this._returnTarget; }

    getLocationSetter(): LocationSetter {
        const length = this._operations.length;
        return {
            set: (node?) => {
                if (node && length < this._operations.length) {
                    this._operations[length].location = node;
                }
            }
        };
    }

    operation(kind: OperationKind, location?: tsm.Node): void {
        var op: Operation = { kind, location };
        this._operations.push(op);
    }

    pushBoolean(value: boolean, location?: tsm.Node): void {
        const kind = OperationKind.PUSHBOOL;
        const op: PushBoolOperation = { kind, value, location };
        this._operations.push(op);
    }

    pushInt(value: bigint, location?: tsm.Node): void {
        const kind = OperationKind.PUSHINT;
        const op: PushIntOperation = { kind, value, location };
        this._operations.push(op);
    }

    pushData(value: ReadonlyUint8Array, location?: tsm.Node) {
        const kind = OperationKind.PUSHDATA;
        const op: PushDataOperation = { kind, value, location };
        this._operations.push(op);
    }

    pushNull(location?: tsm.Node) {
        const kind = OperationKind.PUSHNULL;
        const op = { kind, location };
        this._operations.push(op);
    }

    jump(target: TargetOffset, location?: tsm.Node): void {
        const kind = OperationKind.JMP;
        const op: JumpOperation = { kind, offset: 0, location };
        this._operations.push(op);
        this._jumps.set(op, target);
    }
}
