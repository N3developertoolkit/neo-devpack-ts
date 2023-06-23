/**
 * @contract SinCleanser
 * @extra Author: edge
 * @extra Email: edgedlt@protonmail.com
 * @extra Description: Sacrifice material wealth to lighten your karmic burden
 */

const TOTAL_DONATED_KEY = ByteString.fromHex("0xA0");
const CHARITY_COUNT_KEY = ByteString.fromHex("0xA1");

const DONATORS_PREFIX = ByteString.fromHex("0xB0");
const CHARITIES_PREFIX = ByteString.fromHex("0xB1");
const CHARITY_DONATIONS_PREFIX = ByteString.fromHex("0xB2");

const OWNER_KEY = ByteString.fromHex("0xFF");

/** @struct */
interface Charity {
    name: string;
    address: ByteString;
    description: string;
    website: string;
}

/** @safe */
export function totalDonated(): bigint {
    return Storage.context.get(TOTAL_DONATED_KEY)?.asInteger() ?? 0n;
}

/** @safe */
export function donatedBy(account: ByteString): bigint {
    if (!account || account.length != 20) throw new Error("The argument \"account\" is invalid.");
    const key = concat(DONATORS_PREFIX, account);
    return Storage.context.get(key)?.asInteger() ?? 0n;
}

/** @safe */
export function getCharityIds() {
    return Storage.context.keys(CHARITIES_PREFIX, false); // should be made to return iterator of bigints instead
}

/** @safe */
export function getCharity(charityId: bigint): Map<string, any> {
    const key = concat(CHARITIES_PREFIX, ByteString.fromInteger(charityId));
    const serialized = Storage.context.get(key);

    if (!serialized) throw new Error("Charity not found");

    const deserialized = StdLib.deserialize(serialized) as Charity;
    // const { name, address, description, website } = StdLib.deserialize(serialized) as Charity;

    const map = new Map<string, string | ByteString>();
    map.set("name", deserialized.name);
    map.set("address", deserialized.address);
    map.set("description", deserialized.description);
    map.set("website", deserialized.website);
    return map;
}

/** @safe */
export function getCharityTotalDonated(charityId: bigint): bigint {
    const key = concat(CHARITY_DONATIONS_PREFIX, ByteString.fromInteger(charityId));
    return Storage.context.get(key)?.asInteger() ?? 0n;
}

/** @safe */
export function getOwner(): ByteString {
    return Storage.context.get(OWNER_KEY)!;
}

function addCharityInternal(name: string, address: ByteString, description: string, website: string): bigint {
    const count = Storage.context.get(CHARITY_COUNT_KEY)?.asInteger() ?? 0n;
    const id = count + 1n;

    const charity = {name, address, description, website} as Charity;
    const serialized = StdLib.serialize(charity);
    const charityKey = concat(CHARITIES_PREFIX, ByteString.fromInteger(id));

    Storage.context.put(charityKey, serialized);
    Storage.context.put(CHARITY_COUNT_KEY, ByteString.fromInteger(id));
    return id;
}

export function addCharity(name: string, address: ByteString, description: string, website: string): bigint {
    if (!checkOwner()) throw new Error("Only the contract owner can add a charity");
    return addCharityInternal(name, address, description, website);
}

export function donateTo(account: ByteString, amount: bigint, charityId: bigint): boolean {
    if (amount < 0n) throw new Error("The amount must be a positive number");
    if (!checkWitness(account)) return false;

    Donation(account, charityId, amount);

    updateCharityTotalDonated(charityId, amount);
    updateTotalDonated(amount);
    updateDonatedBy(account, amount);

    return true;
}

// export const donate = (account: ByteString, amount: bigint) => donateTo(account, amount, 1n);
export function donate(account: ByteString, amount: bigint): boolean {
    return donateTo(account, amount, 1n);
}

export function _deploy(_data: any, update: boolean): void {
    if (update) return;
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(OWNER_KEY, tx.sender);

    const name = "Dev Fund";
    const description = "Demo charity functioning as a tip jar for the dev";
    const website = "https://www.youtube.com/watch?v=rg9da6GIsLU"

    addCharityInternal(name, Runtime.executingScriptHash, description, website);
}

export function update(nefFile: ByteString, manifest: string) {
    if (checkOwner()) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw new Error("Only the contract owner can update the contract");
    }
}

export function onNEP17Payment(from: ByteString, amount: bigint, data: ByteString): void {
    if (Runtime.callingScriptHash !== ByteString.fromHex("0xcf76e28bd0062c4a478ee35561011319f3cfa4d2"))
        throw new Error("Only GAS donations are accepted");

    donate(from, amount);
}

function checkOwner() {
    return checkWitness(Storage.context.get(OWNER_KEY)!);
}

function updateCharityTotalDonated(charityId: bigint, amount: bigint) {
    const balance = getCharityTotalDonated(charityId) + amount;
    const key = concat(CHARITY_DONATIONS_PREFIX, ByteString.fromInteger(charityId));
    if (balance === 0n) {
        Storage.context.delete(key);
    } else {
        Storage.context.put(key, ByteString.fromInteger(balance));
    }
}

function updateTotalDonated(amount: bigint) {
    const newTotal = totalDonated() + amount;
    Storage.context.put(TOTAL_DONATED_KEY, ByteString.fromInteger(newTotal));
}

function updateDonatedBy(account: ByteString, amount: bigint): boolean {
    const balance = donatedBy(account) + amount;
    if (balance < 0n) return false;
    const key = concat(DONATORS_PREFIX, account);
    if (balance === 0n) {
        Storage.context.delete(key);
    } else {
        Storage.context.put(key, ByteString.fromInteger(balance));
    }
    return true;
}

/** @event */
declare function Donation(donator: ByteString, charity: BigInt, amount: bigint): void;

/**
 * TODO:
 * Change ByteString to Hash160 where appropriate when supported
 * Fix getCharity call
 * Add pause and resume
 * Add withdraw
 * Add transferOwnership
 * Add removeCharity
 * Add updateCharity
 * Add more events
 */
