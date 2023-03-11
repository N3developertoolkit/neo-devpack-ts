/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

const VALUE_KEY = "0x00";
const OWNER_KEY = "0xFF";

/** @safe */
export function get() { 
    const key = ByteString.fromHex(VALUE_KEY);
    return Storage.context.get(key);
}

export function set(value: ByteString) {
    const key = ByteString.fromHex(VALUE_KEY);
    Storage.context.put(key, value);
}

export function remove() {
    const key = ByteString.fromHex(VALUE_KEY);
    Storage.context.delete(key);
}

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const tx = Runtime.scriptContainer as Transaction;
    const key = ByteString.fromHex(OWNER_KEY);
    Storage.context.put(key, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    const key = ByteString.fromHex(OWNER_KEY);
    const owner = Storage.context.get(key)!;
    // TODO: support "if (owner && checkWitness(owner))"
    if (checkWitness(owner)) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}