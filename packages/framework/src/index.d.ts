
// type TypedArrayMutableProperties = 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort';
// export interface ByteString extends Omit<Uint8Array, TypedArrayMutableProperties> { 
//     readonly [n: number]: number;
// }

// export declare const ByteString: ByteStringConstructor;
// export interface ByteStringConstructor {
//     new(array: ArrayLike<number>): ByteString;
//     new(value: number): ByteString;
//     concat(one: ByteString, two: ByteString): ByteString;
//     from(arrayLike: ArrayLike<number>): ByteString;
//     isValidAddress(account: ByteString): boolean;
// }

// export type StorageValue = boolean | bigint | ByteString;

export interface StorageContext { }

export declare const Storage: StorageConstructor;

export interface StorageConstructor {
    /** @syscall System.Storage.GetContext */ 
    readonly currentContext: StorageContext;

    // /** @syscall System.Storage.Get */ 
    // get(context: StorageContext, key: ByteString): StorageValue | undefined;
    // /** @syscall System.Storage.Put */ 
    // put(context: StorageContext, key: ByteString, value: StorageValue): void;
    // /** @syscall System.Storage.Delete */
    // delete(context: StorageContext, key: ByteString): void;
}

// export type Address = ByteString;
 
// // export interface Address {
// //     [Symbol.iterator](): Iterator<number>;
// //  }
// // export const Address: AddressConstructor;
// // export interface AddressConstructor { }

// export declare const Runtime: RuntimeConstructor;
// export interface RuntimeConstructor {
//     checkWitness(account: Address): boolean;
//     notify(eventName: string, ...params: any[]);
//     readonly scriptContainer: Transaction;
// }

// export interface Transaction {
//     readonly hash: ByteString;
//     readonly version: number;
//     readonly nonce: number;
//     readonly sender: Address;
//     readonly systemFee: bigint;
//     readonly networkFee: bigint;
//     readonly validUntilBlock: bigint;
//     readonly script: ByteString
// }

// export declare const Contract: ContractConstructor;

// export interface Contract {
//     readonly id: number;
//     readonly updateCounter: number;
//     readonly hash: Address;
//     readonly nef: ByteString;
//     readonly manifest: string;
// }

// export interface ContractConstructor {
//     call(hash: Address, method: string, ...params: any[])
// }

// export declare const ContractManagement: ContractManagementConstructor;
// export interface ContractManagementConstructor {
//     update(nefFile: ByteString, manifest: string, data?: any): void;
//     getContract(hash: Address): Contract | undefined;
// }