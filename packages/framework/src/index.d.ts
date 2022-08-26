
type TypedArrayMutableProperties = 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort';
export interface ByteString extends Omit<Uint8Array, TypedArrayMutableProperties> { 
    readonly [n: number]: number;
}
export declare const ByteString: ByteStringConstructor;
export interface ByteStringConstructor {
    from(arrayLike: ArrayLike<number>): ByteString;
    from(value: bigint): ByteString;
}

export type StorageValue = boolean | bigint | ByteString;

export interface StorageContext { }
export declare const Storage: StorageConstructor;
export interface StorageConstructor {
    /** @syscall System.Storage.GetContext */ 
    readonly currentContext: StorageContext;
    /** @syscall System.Storage.Get */ 
    get(context: StorageContext, key: ByteString): StorageValue | undefined;
    /** @syscall System.Storage.Put */ 
    put(context: StorageContext, key: ByteString, value: StorageValue): void;
    /** @syscall System.Storage.Delete */
    delete(context: StorageContext, key: ByteString): void;
}

export type Address = void;

// export interface Address {
//     [Symbol.iterator](): Iterator<number>;
//  }
// export const Address: AddressConstructor;
// export interface AddressConstructor { }
