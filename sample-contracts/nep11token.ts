const SYMBOL = "HVRCRFT";
const DECIMALS = 0n;

const TOTAL_SUPPLY_KEY = ByteString.fromHex("0x00");
const BALANCE_PREFIX = ByteString.fromHex("0x01");
const TOKENID_PREFIX = ByteString.fromHex("0x02");
const TOKEN_PREFIX = ByteString.fromHex("0x03");
const ACCOUNT_TOKEN_PREFIX = ByteString.fromHex("0x04");
const OWNER_KEY = ByteString.fromHex("0xFF");

/** @event */
declare function Transfer(from: ByteString | null, to: ByteString | null, amount: bigint, tokenId: ByteString): void;

/** @safe */
export function symbol() { return SYMBOL; }

/** @safe */
export function decimals() { return DECIMALS; }

/** @safe */
export function totalSupply() {
    const value = Storage.context.get(TOTAL_SUPPLY_KEY);
    return value ? value.asInteger : 0;
}

/** @safe */
export function balanceOf(account: ByteString) {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const key = concat(BALANCE_PREFIX, account);
    const value = Storage.context.get(key);
    return value ? value.asInteger : 0;
}

/** @safe */
export function tokensOf(account: ByteString) {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const key = concat(ACCOUNT_TOKEN_PREFIX, account);
    // Storage.context.find(key, FindOptions.KeysOnly | FindOptions.RemovePrefix)
    return null;
}

export function transfer(to: ByteString, tokenId: ByteString, data: any) {
    // if (to is null || !to.IsValid) throw Error("The argument \"to\" is invalid.");
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    // if (!serialzied) return false;
    // deserialize token state
    // checkwitness of token owner 
    // changer token owner to to
    // serialize token
    // save serialzied token to key
    // update balance of from and to 
    // post transfer
    // return true;

    // TBD returns boolean
    return false;
}

function postTransfer(from: ByteString | null, to: ByteString | null, tokenId: ByteString, data: any) {
    Transfer(from, to, 1n, tokenId);
    if (to) {
        const contract = ContractManagement.getContract(to);
        if (contract) {
            callContract(to, "onNEP11Payment", CallFlags.All, from, 1, tokenId, data);
        }
    }
}

/** @safe */
export function ownerof(tokenId: ByteString) {
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    // deserialize token state
    // return token owner
    return ByteString.fromString('dummy');
}

/** @safe */
export function tokens() {
    // Storage.context.find(TOKEN_PREFIX, FindOptions.KeysOnly | FindOptions.RemovePrefix)

    return null;
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
export function properties(tokenId: ByteString) {
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    // deserialize token state
    // convert token state to map and return
    return null;
}

export function _deploy(_data: any, update: boolean): void {
    if (update) return;
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(OWNER_KEY, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    if (checkOwner()) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}

function checkOwner() {
    const owner = Storage.context.get(OWNER_KEY);
    return owner && checkWitness(owner);
}
