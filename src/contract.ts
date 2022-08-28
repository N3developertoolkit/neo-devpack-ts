import { Storage, ByteString } from '@neo-project/neo-contract-framework';

/** @safe */
export function symbol() { return "TOKEN"; }

/** @safe */
export function decimals() { return 8; }

export function mint(account: ByteString, amount: bigint): void {
    if (amount === 0n) return;
    if (amount < 0n) throw new Error("amount must be greater than zero");

    updateBalance(account, amount);
    updateTotalSupply(amount);
}

const prefixTotalSupply = 0xA0;
const prefixBalance = 0xA1;
// const prefixContractOwner = 0xFF;

function updateBalance(account: ByteString, amount: bigint) {
    const context = Storage.currentContext;
    const key = ByteString.concat(
        ByteString.from([prefixBalance]),
        account);
    const value = Storage.get(context, key);
    let balance = value ? value as bigint : 0n;
    balance = balance + amount;
    if (balance < 0n) return false;
    if (balance === 0n) {
        Storage.delete(context, key);
    } else {
        Storage.put(context, key, balance);
    }
    return true;
}

function updateTotalSupply(amount: bigint) {
    const context = Storage.currentContext;
    const key = ByteString.from([prefixTotalSupply]);
    const value = Storage.get(context, key);
    let totalSupply = value ? value as bigint : 0n;
    totalSupply += amount;
    Storage.put(context, key, totalSupply);
}

// /** @safe */
// export function getValue() { 
//     return neo.Storage.get(neo.Storage.currentContext, neo.ByteString.from([0x00])); 
// }

// export function setValue(value: string) { 
//     neo.Storage.put(neo.Storage.currentContext, neo.ByteString.from([0x00]), value); 
// }

// /** @safe */
// export function helloWorld() { return "Hello, World!"; }

// /** @safe */
// export function sayHello(name: string) { return "Hello, " + name + "!"; }