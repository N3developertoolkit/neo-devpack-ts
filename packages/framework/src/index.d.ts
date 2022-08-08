

export interface ByteString { }
export declare const ByteString: ByteStringConstructor;
export interface ByteStringConstructor {
    from(arrayLike: ArrayLike<number>): ByteString;
    concat(...rest: (number | ArrayLike<number>)[]): ByteString;
}

export interface StorageContext { }
export declare const Storage: StorageConstructor;
export interface StorageConstructor {
    /** @syscall System.Storage.GetContext */ 
    readonly currentContext: StorageContext;
    /** @syscall System.Storage.Get */ 
    get(context: StorageContext, key: ByteString): ByteString;
    /** @syscall System.Storage.Put */ 
    put(context: StorageContext, key: ByteString, value: ByteString): void;
    /** @syscall System.Storage.Delete */
    delete(context: StorageContext, key: ByteString): void;
}

export interface Address {
    [Symbol.iterator](): Iterator<number>;
 }
export const Address: AddressConstructor;
export interface AddressConstructor { }
