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

/** @safe */
export function balanceOf(account: ByteString) { 
    const key = concat(
        Uint8Array.from([prefixTotalSupply]),
        account);
    const value = storageGet(storageGetContext(), key);
    return asInteger(value);
}

export function transfer(from: ByteString, to: ByteString, amount: bigint, data: any) {
    if (amount < 0n) throw Error("The amount must be a positive number");
    if (!runtimeCheckWitness(from)) return false;
    if (amount != 0n) {
        if (!updateBalance(from, -amount)) return false;
        updateBalance(to, amount);
    }
    postTransfer(from, to, amount, data);
    return true;
}

export function mint(account: ByteString, amount: bigint): void {
    if (!checkOwner()) throw Error("Only the contract owner can mint tokens");
    createTokens(account, amount);
}

export function burn(account: ByteString, amount: bigint): void {
    if (amount === 0n) return;
    if (amount < 0n) throw Error("amount must be greater than zero");
    if (!checkOwner()) throw Error("Only the contract owner can mint tokens");
    if (!updateBalance(account, -amount)) throw Error("account did not have sufficient funds to burn");
    updateTotalSupply(-amount);
    postTransfer(account, null, amount, null);
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

/** @event */
declare function Transfer(from: ByteString | null, to: ByteString | null, amount: bigint): void;

function postTransfer(from: ByteString | null, to: ByteString | null, amount: bigint, data: any) {
    Transfer(from, to, amount);
//     if (to) {
//         const contract = ContractManagement.getContract(to);
//         if (contract) {
//             Contract.call(to, "onNEP17Payment", from, amount, data);
//         }
//     }
}
