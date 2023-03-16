const SYMBOL = "HVRCRFT";
const DECIMALS = 0n;

const OWNER_KEY = ByteString.fromHex("0xFF");

/** @event */
declare function Transfer(from: ByteString | null, to: ByteString | null, amount: bigint, tokenId: ByteString): void;

/** @safe */
export function symbol() { return SYMBOL; }

/** @safe */
export function decimals() { return DECIMALS; }

/** @safe */
export function totalSupply( ) { 
    // TBD returns int
    return 0n;
}

/** @safe */
export function balanceOf(account: ByteString) { 
    // TBD returns int
    return 0n;
}

/** @safe */
export function tokensOf(account: ByteString) { 
        // TBD returns iterator

    return null;
}

export function transfer(to: ByteString,tokenId: ByteString, data: any) {
    // TBD returns boolean
    return false;
}

/** @safe */
export function ownerof(tokenId: ByteString) { 
    // TBD returns HASH160
    return ByteString.fromHex("0x00");
}

/** @safe */
export function tokens() { 
    // TBD returns iterator
    return null;
}

// mint
// burn

/** @safe */
export function properties() { 
    // TBD returns MAP
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
