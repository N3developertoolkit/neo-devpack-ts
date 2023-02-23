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
    let context = storageGetContext();
    let key = Uint8Array.from([prefixSampleValue])
    return storageGet(context, key);
}

export function set(value: ByteString) {
    let context = storageGetContext();
    let key = Uint8Array.from([prefixSampleValue])
    storagePut(context, key, value);
}

export function remove() {
    storageDelete(
        storageGetContext(), 
        Uint8Array.from([prefixSampleValue]));
}

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const tx = runtimeGetScriptContainer() as Transaction;
    storagePut(
        storageGetContext(), 
        Uint8Array.from([prefixContractOwner]), 
        tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    const owner = storageGet(
        storageGetContext(), 
        Uint8Array.from([prefixContractOwner]))!;
    if (runtimeCheckWitness(owner)) {
        contractManagementUpdate(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}