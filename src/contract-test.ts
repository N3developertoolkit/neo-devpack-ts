
/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

import { ByteString, storageDelete, storageGet, storageGetContext, storagePut } from "@neo-project/neo-contract-framework";

const prefixSampleValue = 0x00;

/** @safe */
export function get() { 
    const ctx = storageGetContext();
    const key = Uint8Array.from([prefixSampleValue]);
    const value = storageGet(ctx, key);
    return value;
}

export function set(value: ByteString) {
    const ctx = storageGetContext();
    const key = Uint8Array.from([prefixSampleValue]);
    storagePut(ctx, key, value);
}

export function remove() {
    const ctx = storageGetContext();
    const key = Uint8Array.from([prefixSampleValue]);
    storageDelete(ctx, key);
}
