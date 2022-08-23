import { Storage, ByteString } from '@neo-project/neo-contract-framework';

// /** @safe */
// export function symbol() { return "TOKEN"; }

// /** @safe */
// export function decimals() { return 8; }

// export function mint(account: neo.Address, amount: bigint): void {
//     if (amount === 0n) return;
//     if (amount < 0n) throw new Error("amount must be greater than zero");

//     updateBalance(account, amount);
//     updateTotalSupply(amount);
// }

// const _prefixTotalSupply = 0x00;
// const _prefixBalance = 0x10;
// const _prefixContractOwner = 0xFF;

// function updateBalance(account: neo.Address, amount: bigint) {
//     // const context = neo.Storage.currentContext;
//     // const key = [_prefixBalance, ...account] as const;
//     // let balance = neo.Storage.get(context, key) as bigint;
//     // balance += amount;
//     // if (balance < 0n) return false;
//     // if (balance === 0n) {
//     //     neo.Storage.delete(context, key);
//     // } else {
//     //     neo.Storage.put(context, key, balance);
//     // }
//     return true;
// }

function updateTotalSupply(amount: bigint) {
    const context = Storage.currentContext;
    const key = ByteString.from([0x00]);
    let totalSupply = Storage.get(context, key)?.toBigInt() ?? 0n;
    totalSupply = totalSupply + amount;
    Storage.put(context, key, ByteString.from(totalSupply));
}


    // let totalSupply = Storage.get(context, key)?.toBigInt() ?? 0n;

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