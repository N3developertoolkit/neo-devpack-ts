

// export interface ByteString { }

type TypedArrayMutableProperties = 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort';
export interface ByteString extends Omit<Uint8Array, TypedArrayMutableProperties> { 
    readonly [n: number]: number;
    toBigInt(): bigint;
}
export declare const ByteString: ByteStringConstructor;
export interface ByteStringConstructor {
    from(arrayLike: ArrayLike<number>): ByteString;
    from(value: bigint): ByteString;
}

export interface StorageContext { }
export declare const Storage: StorageConstructor;
export interface StorageConstructor {
    /** @syscall System.Storage.GetContext */ 
    readonly currentContext: StorageContext;
    /** @syscall System.Storage.Get */ 
    get(context: StorageContext, key: ByteString): ByteString | undefined;
    /** @syscall System.Storage.Put */ 
    put(context: StorageContext, key: ByteString, value: ByteString): void;
    /** @syscall System.Storage.Delete */
    delete(context: StorageContext, key: ByteString): void;
}

export type Address = void;

// export interface Address {
//     [Symbol.iterator](): Iterator<number>;
//  }
// export const Address: AddressConstructor;
// export interface AddressConstructor { }
