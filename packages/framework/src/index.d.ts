export interface StorageContext { }

export type StorageKey = Uint8Array | string;
export type StorageValue = Uint8Array | string | bigint
 
export const Storage: StorageConstructor;

export interface StorageConstructor {
    /** @syscall System.Storage.GetContext */ 
    readonly currentContext: StorageContext;
    /** @syscall System.Storage.Get */ 
    get(context: StorageContext, key: StorageKey): StorageValue;
    /** @syscall System.Storage.Put */ 
    put(context: StorageContext, key: StorageKey, value: StorageValue): void;
}

export const Address: AddressConstructor;

export interface Address extends ArrayLike<number> {
    [Symbol.iterator](): IterableIterator<number>;
}

export interface AddressConstructor {
}