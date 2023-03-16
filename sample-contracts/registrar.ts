
const PREFIX_DOMAIN = ByteString.fromHex("0x00");
const OWNER_KEY = ByteString.fromHex("0xFF");

/** @safe */
export function query(domain: string): ByteString | undefined { 
    const key = concat(PREFIX_DOMAIN, domain);
    return Storage.context.get(key);
}

export function register(domain: string): boolean {
    const key = concat(PREFIX_DOMAIN, domain);
    const currentOwner = Storage.context.get(key);
    if (currentOwner) {
        log("Domain already registered");
        return false;
    }
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(key, tx.sender);
    return true;
}

export function transfer(domain: string, receiver: ByteString): boolean {
    const key = concat(PREFIX_DOMAIN, domain);
    const currentOwner = Storage.context.get(key);
    if (!currentOwner) {
        log("Domain not registered");
        return false;
    }
    if (!checkWitness(currentOwner)) {
        log("CheckWitness failed");
        return false;
    }
    Storage.context.put(key, receiver);
    return true;
}

export function unregister(domain: string): boolean {
    const key = concat(PREFIX_DOMAIN, domain);
    const currentOwner = Storage.context.get(key);
    if (!currentOwner) {
        log("Domain not registered");
        return false;
    }
    if (!checkWitness(currentOwner)) {
        log("CheckWitness failed");
        return false;
    }
    Storage.context.delete(key);
    return true;
}

export function _deploy(_data: any, update: boolean): void { 
    if (update) return;
    const tx = Runtime.scriptContainer as Transaction;
    Storage.context.put(OWNER_KEY, tx.sender);
}

export function update(nefFile: ByteString, manifest: string) {
    const owner = Storage.context.get(OWNER_KEY);
    if (owner && checkWitness(owner)) {
        ContractManagement.update(nefFile, manifest);
    } else {
        throw Error("Only the contract owner can update the contract");
    }
}
