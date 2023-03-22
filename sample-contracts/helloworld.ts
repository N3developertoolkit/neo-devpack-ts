/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

const VALUE_KEY = ByteString.fromHex("0x00");
const OWNER_KEY = ByteString.fromHex("0xFF");

/** @safe */
export function get() { 
    return Storage.context.get(VALUE_KEY);
}

export function set(value: ByteString) {
    Storage.context.put(VALUE_KEY, value);
}

export function remove() {
    Storage.context.delete(VALUE_KEY);
}

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(OWNER_KEY, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    const owner = Storage.context.get(OWNER_KEY);
    if (owner && checkWitness(owner)) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}
