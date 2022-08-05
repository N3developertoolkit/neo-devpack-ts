

export interface ByteString { }

export interface ByteStringConstructor {
    from(arrayLike: ArrayLike<number>): ByteString;
}

export declare var ByteString: ByteStringConstructor;

export interface StorageContext { }

export declare var Storage: StorageConstructor;

export interface StorageConstructor {
    /** @syscall System.Storage.GetContext */ 
    readonly currentContext: StorageContext;
    /** @syscall System.Storage.Get */ 
    get(context: StorageContext, key: ByteString): ByteString;
    /** @syscall System.Storage.Put */ 
    put(context: StorageContext, key: ByteString, value: ByteString): void;
}

// export const Address: AddressConstructor;

// export interface Address extends ArrayLike<number> {
//     [Symbol.iterator](): IterableIterator<number>;
// }

// export interface AddressConstructor {
// }