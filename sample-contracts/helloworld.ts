/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

const VALUE_KEY = ByteString.fromHex("0x00");
const DATA_KEY = ByteString.fromHex("0x01");
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

interface Data { name: string, owner: ByteString };

export function save(name: string, owner: ByteString) {
    const data: Data = { owner, name };
    const serializedState = StdLib.serialize(data);
    Storage.context.put(DATA_KEY, serializedState);
}

export function load() {
    const serialzied = Storage.context.get(DATA_KEY);
    if (serialzied) {
        const data = StdLib.deserialize(serialzied) as Data;
        return data;
    }
}