/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

const prefixSampleValue = 0x00;
const prefixContractOwner = 0xFF;

/** @safe */
// export function get() { 
//     const key = Uint8Array.from([prefixSampleValue])
//     return Storage.context.get(key);
// }

// export function set(value: ByteString) {
//     const key = Uint8Array.from([prefixSampleValue])
//     Storage.context.put(key, value);
// }

// export function remove() {
//     const key = Uint8Array.from([prefixSampleValue])
//     Storage.context.delete(key);
// }

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const key = Uint8Array.from([prefixContractOwner])
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(key, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    const key = Uint8Array.from([prefixContractOwner])
    const owner = Storage.context.get(key)!;
    // TODO: support "if (owner && runtimeCheckWitness(owner))"
    if (checkWitness(owner)) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}