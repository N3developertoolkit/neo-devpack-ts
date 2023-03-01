/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

import { ByteString, storageGetContext, storageGet, runtimeCheckWitness, contractManagementUpdate, storagePut, runtimeGetScriptContainer, storageDelete, Transaction, StorageContext } from "@neo-project/neo-contract-framework";

const prefixSampleValue = 0x00;
const prefixContractOwner = 0xFF;

/** @safe */
export function get() { 
    const context = storageGetContext();
    const key = Uint8Array.from([prefixSampleValue])
    return storageGet(context, key);
}

export function set(value: ByteString) {
    const context = storageGetContext();
    const key = Uint8Array.from([prefixSampleValue])
    storagePut(context, key, value);
}

export function remove() {
    const context = storageGetContext();
    const key = Uint8Array.from([prefixSampleValue])
    storageDelete(context, key);
}

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const context = storageGetContext();
    const key = Uint8Array.from([prefixContractOwner])
    const tx = runtimeGetScriptContainer() as Transaction;
    storagePut(context, key, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    const context = storageGetContext();
    const key = Uint8Array.from([prefixContractOwner])
    const owner = storageGet(context, key)!;
    // TODO: support "if (owner && runtimeCheckWitness(owner))"
    if (runtimeCheckWitness(owner)) {
        contractManagementUpdate(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}