import { storageGet as get, storageGetContext as getContext } from '@neo-project/neo-contract-framework';

/**
 * @contract ApocToken
 * @extra Author "Harry Pierson"
 * @extra Email "harrypierson@hotmail.com"
 * @extra Description "this is a prototype NEP-17 contract written in TypeScript"
 * @standard "NEP-17"
 */

const SYMBOL = "APOC";
const DECIMALS = 8n;
const INITIAL_SUPPLY = 1_000_000n;

const prefixTotalSupply = 0xA0;
const prefixBalance = 0xA1;
const prefixContractOwner = 0xFF;

// /** @event */
// declare function Transfer(from: Address | undefined, to: Address | undefined, amount: bigint): void;

/** @safe */
export function symbol() { return SYMBOL; }

/** @safe */
export function decimals() { return DECIMALS; }

/** @safe */
export function totalSupply( ) { 
    const ctx = getContext();
    const key = Uint8Array.from([prefixTotalSupply]);
    return get(ctx, key);
}

// /** @safe */
// export function balanceOf(account: Address) { 
    // if (!ByteString.isValidAddress(account)) throw new Error();
    // const context = Storage.currentContext;
    // const key = ByteString.concat(new ByteString(prefixBalance), account);
    // const value = Storage.get(context, key);
    // return value ? value as bigint : 0n;
// }

// export function transfer(from: Address, to: Address, amount: bigint, data: any) {
//     if (!ByteString.isValidAddress(from)) throw new Error();
//     if (!ByteString.isValidAddress(to)) throw new Error();
//     if (amount < 0n) throw new Error("The amount must be a positive number");
//     if (!Runtime.checkWitness(from)) return false;
//     if (amount != 0n) {
//         if (!updateBalance(from, -amount)) return false;
//         updateBalance(to, amount);
//     }
//     postTransfer(from, to, amount, data);
//     return true;
// }

// export function mint(account: Address, amount: bigint): void {
//     if (amount === 0n) return;
//     if (amount < 0n) throw new Error("amount must be greater than zero");
//     var owner = getOwner();
//     if (!Runtime.checkWitness(owner)) throw new Error();

//     createTokens(account, amount);
// }

// export function burn(account: Address, amount: bigint): void {
//     if (amount === 0n) return;
//     if (amount < 0n) throw new Error("amount must be greater than zero");
//     var owner = getOwner();
//     if (!Runtime.checkWitness(owner)) throw new Error();

//     if (!updateBalance(account, -amount)) throw new Error();
//     updateTotalSupply(-amount);
//     postTransfer(account, null, amount, null);
// }

// function postTransfer(from: Address | null, to: Address | null, amount: bigint, data: any) {
//     OnTransfer(from, to, amount);
//     if (to) {
//         const contract = ContractManagement.getContract(to);
//         if (contract) {
//             Contract.call(to, "onNEP17Payment", from, amount, data);
//         }
//     }
// }

// function updateTotalSupply(amount: bigint) {
    // const context = Storage.currentContext;
    // const key = new ByteString(prefixTotalSupply);
    // const value = Storage.get(context, key);
    // let totalSupply = value ? value as bigint : 0n;
    // totalSupply += amount;
    // Storage.put(context, key, totalSupply);
// }

// function updateBalance(account: Address, amount: bigint) {
//     const context = Storage.currentContext;
//     const key = ByteString.concat(new ByteString(prefixBalance), account);
//     const value = Storage.get(context, key);
//     let balance = value ? value as bigint : 0n;
//     balance = balance + amount;
//     if (balance < 0n) return false;
//     if (balance === 0n) {
//         Storage.delete(context, key);
//     } else {
//         Storage.put(context, key, balance);
//     }
//     return true;
// }

// export function _deploy(data: any, update: boolean) { 
//     if (update) return;
//     const key = ByteString.from([prefixContractOwner]);
//     var sender = (Runtime.scriptContainer as Transaction).sender;
//     Storage.put(Storage.currentContext, key, sender);
//     var amount = INITIAL_SUPPLY * (10n ** DECIMALS);
//     createTokens(sender, amount);
// }

// export function update(nefFile: ByteString, manifest: string) {
//     var owner = getOwner();
//     if (!Runtime.checkWitness(owner)) throw new Error();
//     ContractManagement.update(nefFile, manifest);
// }

// function createTokens(account: Address, amount: bigint) {
//     if (amount < 0n) throw new Error("The amount must be a positive number");
//     updateBalance(account, amount);
//     updateTotalSupply(amount);
//     postTransfer(null, account, amount, null);
// }

// function getOwner() {
//     const key = new ByteString(prefixContractOwner);
//     return Storage.get(Storage.currentContext, key) as Address;
// }
