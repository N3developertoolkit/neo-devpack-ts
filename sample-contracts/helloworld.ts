/**
 * @contract Test Contract
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype contract written in TypeScript"
 */

const VALUE_KEY = ByteString.fromHex("0x00");
const DATA_KEY = ByteString.fromHex("0x01");
const OWNER_KEY = ByteString.fromHex("0xFF");

// /** @safe */
// export function get() { 
//     return Storage.context.get(VALUE_KEY);
// }

// export function set(value: ByteString) {
//     Storage.context.put(VALUE_KEY, value);
// }

// export function remove() {
//     Storage.context.delete(VALUE_KEY);
// }

// export function _deploy(_data: any, update: boolean): void { 
//     if (update) return;
//     const tx = Runtime.scriptContainer as Transaction;
//     Storage.context.put(OWNER_KEY, tx.sender);
// }

// export function update(nefFile: ByteString, manifest: string) {
//     const owner = Storage.context.get(OWNER_KEY);
//     if (owner && checkWitness(owner)) {
//         ContractManagement.update(nefFile, manifest);
//     } else {
//         throw Error("Only the contract owner can update the contract");
//     }
// }

interface TestInterface { name: string, owner: ByteString, count: number };

/** @struct */
interface TestStructInterface { name: string, owner: ByteString, count: number };

type TestStructTuple = [string, ByteString, number];

export function test1(name: string, owner: ByteString, count: number) {
    const data: TestInterface = { name, owner, count };
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test1a(name: string, owner: ByteString, count: number) {
    const data = { name, owner, count } as TestInterface;
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test1b(name: string, owner: ByteString, count: number) {
    let data: TestInterface;
    data = { name, owner, count };
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test2(name: string, owner: ByteString, count: number) {
    const data: TestStructInterface = { name, owner, count };
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test2a(name: string, owner: ByteString, count: number) {
    const data = { name, owner, count } as TestStructInterface;
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test2b(name: string, owner: ByteString, count: number) {
    let data: TestStructInterface;
    data = { name, owner, count };
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test3(name: string, owner: ByteString, count: number) {
    const data: TestStructTuple = [name, owner, count];
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test3a(name: string, owner: ByteString, count: number) {
    const data = [name, owner, count] as TestStructTuple;
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}

export function test3b(name: string, owner: ByteString, count: number) {
    let data: TestStructTuple;
    data = [name, owner, count];
    Storage.context.put(DATA_KEY, StdLib.serialize(data));
}
