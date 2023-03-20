const SYMBOL = "HVRCRFT";
const DECIMALS = 0n;

const TOTAL_SUPPLY_KEY = ByteString.fromHex("0x00");
const BALANCE_PREFIX = ByteString.fromHex("0x01");
const TOKENID_PREFIX = ByteString.fromHex("0x02");
const TOKEN_PREFIX = ByteString.fromHex("0x03");
const ACCOUNT_TOKEN_PREFIX = ByteString.fromHex("0x04");
const OWNER_KEY = ByteString.fromHex("0xFF");

/** @event */
declare function Transfer(from: ByteStringInstance | null, to: ByteStringInstance | null, amount: bigint, tokenId: ByteStringInstance): void;

/** @safe */
export function symbol() { return SYMBOL; }

/** @safe */
export function decimals() { return DECIMALS; }

/** @safe */
export function totalSupply(): bigint {
    const value = Storage.context.get(TOTAL_SUPPLY_KEY);
    return value ? value.asInteger() : 0n;
}

/** @safe */
export function balanceOf(account: ByteStringInstance): bigint {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const key = concat(BALANCE_PREFIX, account);
    const value = Storage.context.get(key);
    return value ? value.asInteger() : 0n;
}

/** @safe */
export function tokensOf(account: ByteStringInstance) {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const prefix = concat(ACCOUNT_TOKEN_PREFIX, account);
    return Storage.context.keys(prefix, true)
}

/** @struct */
interface TokenState
{
    owner: ByteStringInstance,
    name: string,
    description: string,
    image: string,
}

export function transfer(to: ByteStringInstance, tokenId: ByteStringInstance, data: any) {
    // if (to is null || !to.IsValid) throw Error("The argument \"to\" is invalid.");
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    if (!serialzied) {
        log("invalid tokenId");
        return false;
    }
    const token = StdLib.deserialize(serialzied) as TokenState;
    const owner = token.owner;
    if (!checkWitness(owner)) {
        log("only token owner can transfer");
        return false;
    }

    if (owner !== to) {
        token.owner = to;
        Storage.context.put(key, StdLib.serialize(token));
        // updateBalance(owner, tokenId, -1);
        // updateBalance(to, tokenId, +1);
    }
    postTransfer(owner, to, tokenId, data);
    return true;
}

function postTransfer(from: ByteStringInstance | null, to: ByteStringInstance | null, tokenId: ByteStringInstance, data: any) {
    Transfer(from, to, 1n, tokenId);
    if (to) {
        const contract = ContractManagement.getContract(to);
        if (contract) {
            callContract(to, "onNEP11Payment", CallFlags.All, from, 1, tokenId, data);
        }
    }
}

/** @safe */
export function ownerof(tokenId: ByteStringInstance) {
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    if (serialzied) {
        const token = StdLib.deserialize(serialzied) as TokenState;
        return token.owner;
    } else {
        return null;
    }
}

/** @safe */
export function tokens() {
    return Storage.context.keys(TOKEN_PREFIX, true);
}

// mint
export function mint(name: string, description: string, imageUrl: string) {
    if (!checkOwner()) throw Error("Only the contract owner can mint tokens");
    // generate new token id
    // create token state struct
    // create token storage key
    // serialize token state
    // save serialized token state to storage
    // update balance
    // update total supply
    // post transfer
    // return token id

    return ByteString.fromString('dummy');

}

/** @safe */
export function properties(tokenId: ByteStringInstance) {
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    
    // if (serialzied) {
    //     const token = StdLib.deserialize(serialzied) as TokenState;
    //     const map = new Map<string, any>();
    //     map.set("owner", token.owner);
    //     map.set("name", token.name);
    //     map.set("description", token.description);
    //     map.set("image", token.image);
    //     return map;
    // } else {
        return null;
    // }
}

export function _deploy(_data: any, update: boolean): void {
    if (update) return;
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(OWNER_KEY, tx.sender);
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
