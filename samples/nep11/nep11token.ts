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
    return Storage.context.get(TOTAL_SUPPLY_KEY)?.asInteger() ?? 0n;
}

/** @safe */
export function balanceOf(account: ByteString): bigint {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const key = concat(BALANCE_PREFIX, account);
    return Storage.context.get(key)?.asInteger() ?? 0n;
}

/** @safe */
export function tokensOf(account: ByteString) {
    if (!account || account.length != 20) throw Error("The argument \"account\" is invalid.");
    const prefix = concat(ACCOUNT_TOKEN_PREFIX, account);
    return Storage.context.keys(prefix, true)
}

// /** @struct */
// interface TokenState {
//     owner: ByteString;
//     name: string;
//     description: string;
//     image: string;
// }

type TokenState = [ByteString, string, string, string];

export function transfer(to: ByteString, tokenId: ByteString, data: any) {
    if (!to || to.length != 20) throw Error("The argument \"to\" is invalid.");
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    if (!serialzied) {
        log("invalid tokenId");
        return false;
    }
    const token = StdLib.deserialize(serialzied) as TokenState;
    const [owner] = token;
    if (!checkWitness(owner)) {
        log("only token owner can transfer");
        return false;
    }

    if (owner !== to) {
        token[0] = to;
        Storage.context.put(key, StdLib.serialize(token));
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
    const serialzied = Storage.context.get(key);
    if (serialzied) {
        const [owner] = StdLib.deserialize(serialzied) as TokenState;
        return owner;
    } else {
        return null;
    }
}

/** @safe */
export function tokens() {
    return Storage.context.keys(TOKEN_PREFIX, true);
}

// mint
export function mint(owner: ByteString, name: string, description: string, image: string) {
    if (!checkOwner()) throw Error("Only the contract owner can mint tokens");

    const id = Storage.context.get(TOKENID_KEY)?.asInteger() ?? 0n;
    Storage.context.put(TOKENID_KEY, ByteString.fromInteger(id + 1n));

    const idString = concat(SYMBOL, ByteString.fromInteger(id));
    const tokenId = CryptoLib.sha256(idString);

    const tokenState: TokenState = [owner, name, description, image ];
    const serializedState = StdLib.serialize(tokenState);
    const tokenKey = concat(TOKEN_PREFIX, tokenId);
    Storage.context.put(tokenKey, serializedState);
    updateBalance(owner, tokenId, 1n);
    updateTotalSupply(1n);
    postTransfer(null, owner, tokenId, null);
    return tokenId;
}

/** @safe */
export function properties(tokenId: ByteString) {
    const key = concat(TOKEN_PREFIX, tokenId);
    const serialzied = Storage.context.get(key);
    
    if (serialzied) {
        const [owner, name, description, image] = StdLib.deserialize(serialzied) as TokenState;
        const map = new Map<string, any>();
        map.set("owner", owner);
        map.set("name", name);
        map.set("description", description);
        map.set("image", image);
        return map;
    } else {
        return undefined;
    }
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
    return checkWitness(Storage.context.get(OWNER_KEY)!);
}

function updateTotalSupply(increment: bigint) {
    const totalSupply = Storage.context.get(TOTAL_SUPPLY_KEY)?.asInteger() ?? 0n;
    Storage.context.put(TOTAL_SUPPLY_KEY, ByteString.fromInteger(totalSupply + increment))

}

function updateBalance(account: ByteString, tokenId: ByteString, increment: bigint) {
    const balanceKey = concat(BALANCE_PREFIX, account);
    const balance = Storage.context.get(balanceKey)?.asInteger() ?? 0n;
    const newBalance = balance + increment;
    if (newBalance < 0) throw Error();
    else if (newBalance === 0n) Storage.context.delete(balanceKey);
    else Storage.context.put(balanceKey, ByteString.fromInteger(newBalance))

    const accountTokenKey = concat(ACCOUNT_TOKEN_PREFIX, concat(account, tokenId));
    if (increment > 0n) Storage.context.put(accountTokenKey, ByteString.fromInteger(0n))
    else Storage.context.delete(accountTokenKey);
}

