// /**
//  * @contract TankToken
//  * @extra Author "Harry Pierson"
//  * @extra Email "harrypierson@hotmail.com"
//  * @extra Description "this is a prototype NEP-17 contract written in TypeScript"
//  * @standard "NEP-17"
//  */

const SYMBOL = "TANK";
const DECIMALS = 4n;
const INITIAL_SUPPLY = 1_000_000n;

const TOTAL_SUPPLY_KEY = ByteString.fromHex("0xA0");
const BALANCE_PREFIX = ByteString.fromHex("0xA1");
const OWNER_KEY = ByteString.fromHex("0xFF");

/** @safe */
export function symbol() { return SYMBOL; }

/** @safe */
export function decimals() { return DECIMALS; }

/** @safe */
export function totalSupply(): bigint {
    return Storage.context.get(TOTAL_SUPPLY_KEY)!.asInteger();
}

/** @safe */
export function balanceOf(account: ByteStringInstance): bigint {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const key = concat(BALANCE_PREFIX, account);
    const value = Storage.context.get(key);
    return value?.asInteger() ?? 0n;
}

export function transfer(from: ByteStringInstance, to: ByteStringInstance, amount: bigint, data: any) {
    if (!from || from.length != 20) throw Error("The argument \"from\" is invalid.");
    if (!to || to.length != 20) throw Error("The argument \"to\" is invalid.");
    if (amount < 0n) throw Error("The amount must be a positive number");
    if (!checkWitness(from)) return false;
    if (amount != 0n) {
        if (!updateBalance(from, -amount)) return false;
        updateBalance(to, amount);
    }
    postTransfer(from, to, amount, data);
    return true;
}

export function mint(account: ByteStringInstance, amount: bigint): boolean {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    if (!checkOwner()) throw Error("Only the contract owner can mint tokens");
    createTokens(account, amount);
    return true;
}

export function burn(account: ByteStringInstance, amount: bigint): boolean {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    if (amount < 0n) throw Error("amount must be greater than zero");
    if (!checkOwner()) throw Error("Only the contract owner can burn tokens");
    if (amount != 0n) {
        if (!updateBalance(account, -amount)) return false;
        updateTotalSupply(-amount);
    }
    postTransfer(account, null, amount, null);
    return true;
}

export function _deploy(_data: any, update: boolean): void {
    if (update) return;
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(OWNER_KEY, tx.sender);
    createTokens(tx.sender, INITIAL_SUPPLY * (10n ** DECIMALS))
}

export function update(nefFile: ByteStringInstance, manifest: string) {
    if (checkOwner()) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}

function checkOwner() {
    return checkWitness(Storage.context.get(OWNER_KEY)!);
}

function createTokens(account: ByteStringInstance, amount: bigint) {
    if (amount < 0n) throw Error("The amount must be a positive number");
    if (amount !== 0n) {
        updateTotalSupply(amount);
        updateBalance(account, amount);
    }
    postTransfer(null, account, amount, null);
}

function updateTotalSupply(amount: bigint) {
    const totalSupply = Storage.context.get(TOTAL_SUPPLY_KEY)!.asInteger();
    Storage.context.put(TOTAL_SUPPLY_KEY, ByteString.fromInteger(totalSupply + amount));
}

function updateBalance(account: ByteStringInstance, amount: bigint): boolean {
    const key = concat(BALANCE_PREFIX, account);
    const balance = (Storage.context.get(key)?.asInteger() ?? 0n) + amount;
    if (balance < 0n) return false;
    if (balance === 0n) {
        Storage.context.delete(key);
    } else {
        Storage.context.put(key, ByteString.fromInteger(balance));
    }
    return true;
}

/** @event */
declare function Transfer(from: ByteStringInstance | null, to: ByteStringInstance | null, amount: bigint): void;

function postTransfer(from: ByteStringInstance | null, to: ByteStringInstance | null, amount: bigint, data: any) {
    Transfer(from, to, amount);
    if (to) {
        const contract = ContractManagement.getContract(to);
        if (contract) {
            callContract(to, "onNEP17Payment", CallFlags.All, from, amount, data);
        }
    }
}
