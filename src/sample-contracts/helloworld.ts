/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

import { ByteString, storageGetContext, storageGet, runtimeCheckWitness, contractManagementUpdate, storagePut, runtimeGetScriptContainer, storageDelete, Transaction } from "@neo-project/neo-contract-framework";

const prefixSampleValue = 0x00;
const prefixContractOwner = 0xFF;


/** @safe */
export function get() { 
    const ctx = storageGetContext();
    const key = Uint8Array.from([prefixSampleValue]);
    return storageGet(ctx, key);
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

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const tx = runtimeGetScriptContainer() as Transaction;

    const ctx = storageGetContext()
    const key = Uint8Array.from([prefixContractOwner]);
    storagePut(ctx, key, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    const ctx = storageGetContext();
    const key = Uint8Array.from([prefixContractOwner]);
    const owner = storageGet(ctx, key)!;
    if (runtimeCheckWitness(owner)) {
        contractManagementUpdate(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}