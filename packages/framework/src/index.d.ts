
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


// There are 7 interop Contract service
// three are internal use only: CallNative, NativeOnPersist and NativePostPersist
// one has no params: GetCallFlags
// The rest are static methods: Call, CreateStandardAccount, CreateMultisigAccount

// There are 2 interop Crypto services
// both are static methods: CheckSig and CheckMultisig

// There are 2 interop Iterator services
// both take a single IIterator parameter: Next and Value

// There are 18 interop Runtime services
// 12 have no params:
//      GetTrigger, Platform, GetScriptContainer, GetExecutingScriptHash, GetCallingScriptHash, 
//      GetEntryScriptHash, GetTime, GetInvocationCounter, GasLeft, GetAddressVersion
//      GetNetwork, GetRandom
// 6 static methods: 
//      GetNotifications, CheckWitness, Log, Notify, LoadScript, BurnGas

// export type StorageValue = boolean | bigint | ByteString;

// There are 7 interop Storage services
// two have no params: GetContext and GetReadOnlyContext
// five have an initial StorageContext param: AsReadOnly, Get, Find, Put, Delete

export interface StorageContext {
    /** @syscall System.Storage.AsReadOnly */ 
    asReadOnly(): StorageContext;
    /** @syscall System.Storage.Get */ 
    get(key: any): any;
    /** @syscall System.Storage.Find */ 
    find(prefix: any, options: any): any;
    /** @syscall System.Storage.Put */ 
    put(key: any, value: any): void;
    /** @syscall System.Storage.Delete */ 
    delete(key: any):void;
}

export declare const Storage: StorageConstructor;

export interface StorageConstructor {
    /** @syscall System.Storage.GetContext */ 
    readonly context: StorageContext;
    /** @syscall System.Storage.GetReadOnlyContext */ 
    readonly readOnlyContext: StorageContext;

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