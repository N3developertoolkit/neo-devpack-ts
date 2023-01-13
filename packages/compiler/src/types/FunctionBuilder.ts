// import * as tsm from "ts-morph";
// import { ConvertOperation, InitSlotOperation, Operation, OperationKind, JumpOperation, JumpOperationKind, LoadStoreOperation, PushDataOperation, PushIntOperation, specializedOperationKinds, SysCallOperation, isJumpOperation, CallOperation } from "./Operation";
// import { sc } from '@cityofzion/neon-core'
// import { FunctionSymbolDef } from "../scope";

// export interface TargetOffset {
//     operation: Operation | undefined
// }

// export interface NodeSetter {
//     set(node?: tsm.Node): void;
// }

// type NodeSetterWithInstruction = NodeSetter & { readonly instruction: Operation };

// export type SlotType = 'local' | 'static' | 'parameter';

// export interface LocalVariable {
//     name: string,
//     index: number,
//     type: tsm.Type,
// }

// export class FunctionBuilder {
//     private readonly _operations = new Array<Operation>();
//     private readonly _locals = new Array<tsm.VariableDeclaration>();
//     private readonly _returnTarget: TargetOffset = { operation: undefined }
//     private readonly _jumps = new Map<JumpOperation, TargetOffset>();

//     constructor(readonly paramCount: number) {}

//     get returnTarget(): Readonly<TargetOffset> { return this._returnTarget; }

//     addLocal(decl: tsm.VariableDeclaration) {
//         const length = this._locals.push(decl);
//         return length - 1;
//     }

//     get locals(): ReadonlyArray<LocalVariable> {
//         return this._locals.map((v, i) => ({
//             name: v.getName(),
//             index: i,
//             type: v.getType()

//         }));
//     }

//     get operations(): IterableIterator<Operation> { return this.getOperations(); }
//     private *getOperations() {
//         const localCount = this._locals.length;
//         if (this.paramCount > 0 || localCount > 0) {
//             const ins: InitSlotOperation = {
//                 kind: OperationKind.INITSLOT,
//                 localCount: localCount,
//                 paramCount: this.paramCount,
//             }
//             yield ins;
//         }

//         const length = this._operations.length;
//         for (let i = 0; i < length; i++) {
//             const op = this._operations[i];
//             if (isJumpOperation(op)) {
//                 const kind = op.kind;
//                 let offset = 0;
//                 const target = this._jumps.get(op);
//                 if (target && target.operation) {
//                     const index = this._operations.indexOf(target.operation);
//                     if (index >= 0) {
//                         offset = index - i;
//                     }
//                 }
//                 yield { kind, offset};
//             } else {
//                 yield op;
//             }
//         }
//     }

//     getNodeSetter(): NodeSetter {
//         const length = this._operations.length;
//         return {
//             set: (node?) => {
//                 if (node && length < this._operations.length) {
//                     this._operations[length].location = node;
//                 }
//             }
//         }
//     }

//     push(ins: Operation | OperationKind): NodeSetterWithInstruction {
//         if (typeof ins !== 'object') {
//             if (specializedOperationKinds.includes(ins)) {
//                 throw new Error(`Invalid ${OperationKind[ins]} instruction`)
//             }
//             ins = { kind: ins };
//         }
//         const index = this._operations.push(ins) - 1;
//         return {
//             instruction: ins,
//             set: (node?) => {
//                 if (node) {
//                     this._operations[index].location = node;
//                 }
//             }
//         }
//     }

//     pushCall(symbolDef: FunctionSymbolDef) {
//         const ins: CallOperation = { kind: OperationKind.CALL, symbol: symbolDef.symbol };
//         return this.push(ins);
//     }

//     pushConvert(type: sc.StackItemType) {
//         const ins: ConvertOperation = { kind: OperationKind.CONVERT, type };
//         return this.push(ins);
//     }

//     pushInt(value: number | bigint) {
//         if (typeof value === 'number') {
//             if (!Number.isInteger(value)) throw new Error(`invalid non-integer number ${value}`);
//             value = BigInt(value);
//         }

//         const ins: PushIntOperation = { kind: OperationKind.PUSHINT, value };
//         return this.push(ins);
//     }

//     pushData(value: string | Uint8Array) {
//         if (typeof value === 'string') {
//             value = Buffer.from(value, 'utf8');
//         }
//         const ins: PushDataOperation = { kind: OperationKind.PUSHDATA, value };
//         return this.push(ins);
//     }

//     pushJump(kind: JumpOperationKind, target: TargetOffset) {
//         const ins: JumpOperation = { kind, offset: 0 };
//         this._jumps.set(ins, target);
//         return this.push(ins);
//     }

//     pushLoad(slot: SlotType, index: number) {
//         const kind = slot === 'local'
//             ? OperationKind.LDLOC
//             : slot === 'parameter'
//                 ? OperationKind.LDARG
//                 : OperationKind.LDSFLD;
//         const ins: LoadStoreOperation = { kind, index };
//         return this.push(ins);
//     }

//     pushStore(slot: SlotType, index: number) {
//         const kind = slot === 'local'
//             ? OperationKind.STLOC
//             : slot === 'parameter'
//                 ? OperationKind.STARG
//                 : OperationKind.STSFLD;
//         const ins: LoadStoreOperation = { kind, index };
//         return this.push(ins);
//     }

//     pushReturn() {
//         if (this._returnTarget.operation) { throw new Error("returnTarget already set"); }
//         this._returnTarget.operation = this.push(OperationKind.RET).instruction;
//     }

//     pushSysCall(service: sc.InteropServiceCode) {
//         const ins: SysCallOperation = { kind: OperationKind.SYSCALL, service };
//         return this.push(ins);
//     }
// }
