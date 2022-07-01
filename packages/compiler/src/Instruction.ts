import { sc } from "@cityofzion/neon-core";

export class Instruction {
    readonly operand?: Uint8Array;
    get opCodeName() { return sc.OpCode[this.opCode]; }

    constructor(
        readonly opCode: sc.OpCode,
        operand?: Uint8Array | Iterable<number>
    ) {
        // TODO: ensure operand size matches expected size for opCode 
        this.operand = operand
            ? operand instanceof Uint8Array
                ? operand
                : Uint8Array.from(operand)
            : undefined;
    }

    toArray(): Uint8Array {
        const length = this.operand ? this.operand.length + 1 : 1;
        const array = new Uint8Array(length);
        array[0] = this.opCode;
        if (this.operand) { array.set(this.operand, 1); }
        return array;
    }
}
