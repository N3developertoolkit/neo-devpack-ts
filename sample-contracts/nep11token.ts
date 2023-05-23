const SYMBOL = "HVRCRFT";
const DECIMALS = 0n;

const TOTAL_SUPPLY_KEY = ByteString.fromHex("0x00");
const BALANCE_PREFIX = ByteString.fromHex("0x01");
const TOKENID_KEY = ByteString.fromHex("0x02");
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
export function totalSupply(): bigint {
    const value = $torage.context.get(TOTAL_SUPPLY_KEY);
    return value ? value.asInteger() : 0n;
}

/** @safe */
export function balanceOf(account: ByteString): bigint {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const key = concat(BALANCE_PREFIX, account);
    const value = $torage.context.get(key);
    return value ? value.asInteger() : 0n;
}

/** @safe */
export function tokensOf(account: ByteString) {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const prefix = concat(ACCOUNT_TOKEN_PREFIX, account);
    return $torage.context.keys(prefix, true)
}

/** @struct */
interface TokenState {
    owner: ByteString;
    name: string;
    description: string;
    image: string;
}

export function transfer(to: ByteString, tokenId: ByteString, data: any) {
    if (!to || to.length != 20) throw Error("The argument \"to\" is invalid.");
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = $torage.context.get(key);
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
        $torage.context.put(key, StdLib.serialize(token));
        updateBalance(owner, tokenId, -1n);
        updateBalance(to, tokenId, 1n);
    }
    postTransfer(owner, to, tokenId, data);
    return true;
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
    const serialzied = $torage.context.get(key);
    if (serialzied) {
        // const { owner } = StdLib.deserialize(serialzied) as TokenState;
        const token = StdLib.deserialize(serialzied) as TokenState;
        return token.owner;
    } else {
        return null;
    }
}

/** @safe */
export function tokens() {
    return $torage.context.keys(TOKEN_PREFIX, true);
}

// mint
export function mint(owner: ByteString, name: string, description: string, image: string) {
    if (!checkOwner()) throw Error("Only the contract owner can mint tokens");

    const id = $torage.context.get(TOKENID_KEY)?.asInteger() ?? 0n;
    $torage.context.put(TOKENID_KEY, ByteString.fromInteger(id + 1n));

    const idString = concat(SYMBOL, ByteString.fromInteger(id));
    const tokenId = CryptoLib.sha256(idString);

    const tokenState: TokenState = { owner, name, description, image };
    const serializedState = StdLib.serialize(tokenState);
    const tokenKey = concat(TOKEN_PREFIX, tokenId);
    $torage.context.put(tokenKey, serializedState);
    updateBalance(owner, tokenId, 1n);
    updateTotalSupply(1n);
    postTransfer(null, owner, tokenId, null);
    return tokenId;
}

/** @safe */
export function properties(tokenId: ByteString) {
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = $torage.context.get(key);
    
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
    $torage.context.put(OWNER_KEY, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    if (checkOwner()) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}

function checkOwner() {
    return checkWitness($torage.context.get(OWNER_KEY)!);
}

function updateTotalSupply(increment: bigint) {
    const totalSupply = $torage.context.get(TOTAL_SUPPLY_KEY)?.asInteger() ?? 0n;
    $torage.context.put(TOTAL_SUPPLY_KEY, ByteString.fromInteger(totalSupply + increment))

}

function updateBalance(account: ByteString, tokenId: ByteString, increment: bigint) {
    const balanceKey = concat(BALANCE_PREFIX, account);
    const balance = $torage.context.get(balanceKey)?.asInteger() ?? 0n;
    const newBalance = balance + increment;
    if (newBalance < 0) throw Error();
    else if (newBalance === 0n) $torage.context.delete(balanceKey);
    else $torage.context.put(balanceKey, ByteString.fromInteger(newBalance))

    const accountTokenKey = concat(ACCOUNT_TOKEN_PREFIX, concat(account, tokenId));
    if (increment > 0n) $torage.context.put(accountTokenKey, ByteString.fromInteger(0n))
    else $torage.context.delete(accountTokenKey);
}

