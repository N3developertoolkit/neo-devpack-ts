import * as tsm from "ts-morph";

const checkFlags = (type: tsm.Type, flags: tsm.ts.TypeFlags) => type.getFlags() & flags;

export const isBigIntLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.BigIntLike);
export const isBooleanLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.BooleanLike);
export const isNumberLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.NumberLike);
export const isStringLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.StringLike);
export const isVoidLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.VoidLike);

// convert JS BigInt to C# BigInt byte array encoding
export function bigIntToByteArray(value: bigint): Uint8Array {
    if (value >= 0n) {
        // convert vsalue to buffer
        let buffer = toBuffer(value);
        // if the most significant bit is 1, prepend a 0x00 byte to 
        // indicate positive value
        if (buffer[0] & 0x80) {
            buffer = Buffer.concat([Buffer.alloc(1, 0), buffer])
        }
        // reverse endianess
        return buffer.reverse();
    } else {
        // convert negative number to positive and create buffer 
        let buffer = toBuffer(value * -1n);
        // if the buffer has all the bits set, prepend an empty padding byte
        buffer = allBitsSet(buffer) 
            ? Buffer.concat([Buffer.alloc(1, 0x00), buffer])
            : buffer;
        // invert the bits
        const end = buffer.length;
        let i = 0;
        while (i < end) {
            buffer[i] = buffer[i] ^ 0xff;
            i++;
        }
        // Convert the updated buffer to a bigint, add one, 
        // and convert back to buffer
        let buffer2 = toBuffer(toBigInt(buffer) + 1n);
        // if the most significant bit isn't 1, prepend a 0xff byte 
        // to indicate negative value
        if (!(buffer2[0] & 0x80)) {
            buffer2 = Buffer.concat([Buffer.alloc(1, 0xff), buffer2])
        }
        // reverse endianess
        return buffer2.reverse();
    }

    function allBitsSet(buffer: Buffer): boolean {
        const length = buffer.length;
        for (let i = 0; i < length; i++) {
            if (buffer[i] !== 0xff) return false;
        }
        return true;
    }

    function toBigInt(buffer: Buffer): bigint {
        return BigInt(`0x${buffer.toString('hex')}`);
    }

    function toBuffer(value: bigint): Buffer {
        let str = value.toString(16);
        if (str.length % 2 == 1) { str = '0' + str }
        return Buffer.from(str, 'hex');
    }
}

