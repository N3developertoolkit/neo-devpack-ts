// /**
//  * @contract TankToken
//  * @extra Author "Harry Pierson"
//  * @extra Email "harrypierson@hotmail.com"
//  * @extra Description "this is a prototype NEP-17 contract written in TypeScript"
//  * @standard "NEP-17"
//  */

const SYMBOL = "TANK";
const DECIMALS = 8n;
const INITIAL_SUPPLY = 1_000_000n;

/** @safe */
export function symbol() { return SYMBOL; }

/** @safe */
export function decimals() { return DECIMALS; }

/** @safe */
export function totalSupply( ) { 
    const key = ByteString.fromHex("0xA0");
    const value = Storage.context.get(key);
    return asInteger(value);
}

// /** @safe */
export function balanceOf(account: ByteString) { 
    const key = concat(
        ByteString.fromHex("0xA1"),
        account);
    const value = Storage.context.get(key);
    return asInteger(value);
}

export function transfer(from: ByteString, to: ByteString, amount: bigint, data: any) {
    if (amount < 0n) throw Error("The amount must be a positive number");
    if (!checkWitness(from)) return false;
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
    const tx = Runtime.scriptContainer as Transaction;
    const key = ByteString.fromHex("0xFF");
    Storage.context.put(key, tx.sender);
    createTokens(tx.sender, INITIAL_SUPPLY * (10n ** DECIMALS))
}

export function update(nefFile: ByteString, manifest: string) {
    if (checkOwner()) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}

function checkOwner() {
    const key = ByteString.fromHex("0xFF");
    const owner = Storage.context.get(key)!;
    // TODO: support "if (owner && checkWitness(owner))"
    return checkWitness(owner);
}

function createTokens(account: ByteString, amount: bigint) {
    if (amount === 0n) return;
    if (amount < 0n) throw Error("The amount must be a positive number");
    updateTotalSupply(amount);
    updateBalance(account, amount);
    postTransfer(null, account, amount, null);
}

function updateTotalSupply(amount: bigint) {
    const key = ByteString.fromHex("0xA0");
    const totalSupply = asInteger(Storage.context.get(key));
    Storage.context.put(key, asByteString(totalSupply + amount));
}

function updateBalance(account: ByteString, amount: bigint): boolean {
    const key = concat(
        ByteString.fromHex("0xA1"),
        account);
    const balance = asInteger(Storage.context.get(key)) + amount;
    if (balance < 0n) return false;
    if (balance === 0n) {
        Storage.context.delete(key);
    } else {
        Storage.context.put(key, asByteString(balance));
    }
    return true;
}

/** @event */
declare function Transfer(from: ByteString | null, to: ByteString | null, amount: bigint): void;

function postTransfer(from: ByteString | null, to: ByteString | null, amount: bigint, data: any) {
    Transfer(from, to, amount);
    if (to) {
        const contract = ContractManagement.getContract(to);
        if (contract) {
            callContract(to, "onNEP17Payment", 15 /*callFlagsAll*/, from, amount, data);
        }
    }
}
