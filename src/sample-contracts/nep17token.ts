// import { ByteString, storageGet, storageGetContext } from '@neo-project/neo-contract-framework';

import { runtimeGetScriptContainer, Transaction, storagePut, storageGetContext, ByteString, storageGet, runtimeCheckWitness, contractManagementUpdate, asInteger, asByteString, concat, storageDelete } from "@neo-project/neo-contract-framework";

// /**
//  * @contract ApocToken
//  * @extra Author "Harry Pierson"
//  * @extra Email "harrypierson@hotmail.com"
//  * @extra Description "this is a prototype NEP-17 contract written in TypeScript"
//  * @standard "NEP-17"
//  */

const SYMBOL = "APOC";
const DECIMALS = 8n;
const INITIAL_SUPPLY = 1_000_000n;

const prefixTotalSupply = 0xA0;
// const prefixBalance = 0xA1;
const prefixContractOwner = 0xFF;

/** @safe */
export function symbol() { return SYMBOL; }

/** @safe */
export function decimals() { return DECIMALS; }

/** @safe */
export function totalSupply( ) { 
    const value = storageGet(
        storageGetContext(), 
        Uint8Array.from([prefixTotalSupply]));

    return asInteger(value);
}

export function mint(account: ByteString, amount: bigint): void {
    if (!checkOwner()) throw Error("Only the contract owner can mint tokens");
    createTokens(account, amount);
}

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const tx = runtimeGetScriptContainer() as Transaction;
    storagePut(
        storageGetContext(), 
        Uint8Array.from([prefixContractOwner]), 
        tx.sender);
    createTokens(tx.sender, INITIAL_SUPPLY * (10n ** DECIMALS))
}

export function update(nefFile: ByteString, manifest: string) {
    if (checkOwner()) {
        contractManagementUpdate(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}

function checkOwner() {
    const owner = storageGet(
        storageGetContext(), 
        Uint8Array.from([prefixContractOwner]))!;
    return runtimeCheckWitness(owner);
}

function createTokens(account: ByteString, amount: bigint) {
    if (amount === 0n) return;
    if (amount < 0n) throw Error("The amount must be a positive number");
    updateTotalSupply(amount);
    updateBalance(account, amount);
    postTransfer(null, account, amount, null);
}

function updateTotalSupply(amount: bigint) {
    const ctx = storageGetContext();
    const key = Uint8Array.from([prefixTotalSupply]);
    const totalSupply = asInteger(storageGet(ctx, key));
    storagePut(ctx, key, asByteString(totalSupply + amount));
}

function updateBalance(account: ByteString, amount: bigint): boolean {
    const ctx = storageGetContext();
    const key = concat(
        Uint8Array.from([prefixTotalSupply]),
        account);
    const balance = asInteger(storageGet(ctx, key)) + amount;
    if (balance < 0n) return false;
    if (balance === 0n) {
        storageDelete(ctx, key);
    } else {
        storagePut(ctx, key, asByteString(balance));
    }
    return true;
}

// /** @event */
// declare function Transfer(from: ByteString | undefined, to: ByteString | undefined, amount: bigint): void;


function postTransfer(from: ByteString | undefined | null, to: ByteString | undefined | null, amount: bigint, data: any) {
//     OnTransfer(from, to, amount);
//     if (to) {
//         const contract = ContractManagement.getContract(to);
//         if (contract) {
//             Contract.call(to, "onNEP17Payment", from, amount, data);
//         }
//     }
}

// ==============================================================





// /** @safe */
// export function balanceOf(account: Address) { 
//     if (!ByteString.isValidAddress(account)) throw new Error();
//     const context = Storage.currentContext;
//     const key = ByteString.concat(new ByteString(prefixBalance), account);
//     const value = Storage.get(context, key);
//     return value ? value as bigint : 0n;
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



// export function burn(account: Address, amount: bigint): void {
//     if (amount === 0n) return;
//     if (amount < 0n) throw new Error("amount must be greater than zero");
//     var owner = getOwner();
//     if (!Runtime.checkWitness(owner)) throw new Error();

//     if (!updateBalance(account, -amount)) throw new Error();
//     updateTotalSupply(-amount);
//     postTransfer(account, null, amount, null);
// }






