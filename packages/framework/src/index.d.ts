
// There are 9 NeoVM Types: Pointer, Boolean, Integer, ByteString, Buffer, Array, Struct, Map, InteropInterface
//  * five types have direct TS equivalents: Boolean/boolean, Integer/bigint, Buffer/Uint8Array, Array/Array, Map/Map
//  * ByteString is defined as ReadonlyUint8Array as per https://www.growingwiththeweb.com/2020/10/typescript-readonly-typed-arrays.html
//  * Pointer, Struct and InteropInterface are all TBD

export interface ByteString extends Omit<Uint8Array, 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort'> { }

/**
 * @operation duplicate 
 * @operation isnull
 * @operation jumpif 3
 * @operation convert Integer 
 * @operation jump 3
 * @operation drop 
 * @operation pushint 0
 */
export declare function asInteger(value: ByteString | null | undefined): bigint;

/**
 * @operation convert ByteString
 */
export declare function asByteString(value: bigint): ByteString;

/**
 * @operation concat
 */
export declare function concat(value1: ByteString, value2: ByteString): ByteString;

export const callFlagsNone = 0;
export const callFlagsReadStates = 1;
export const callFlagsWriteStates = 2;
export const callFlagsAllowCall = 4;
export const callFlagsAllowNotify = 8;
export const callFlagsStates = 3;
export const callFlagsReadOnly = 5;
export const callFlagsAll = 15

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

// There are 7 interop Storage services
// two have no params: GetContext and GetReadOnlyContext
// five have an initial StorageContext param: AsReadOnly, Get, Find, Put, Delete

// syscall System.Contract.Call 
// export declare function contractCall(scriptHash: ByteString, method: string, ): any;

export interface StorageContext { }

/** @syscall System.Storage.GetContext */
export declare function storageGetContext(): StorageContext;
/** @syscall System.Storage.GetReadOnlyContext */
export declare function storageGetReadOnlyContext(): StorageContext;
/** @syscall System.Storage.AsReadOnly */
export declare function storageAsReadOnly(context: StorageContext): StorageContext;
/** @syscall System.Storage.Get */
export declare function storageGet(context: StorageContext, key: ByteString): ByteString | undefined;
/** @syscall System.Storage.Put */
export declare function storagePut(context: StorageContext, key: ByteString, value: ByteString): void;
/** @syscall System.Storage.Delete */
export declare function storageDelete(context: StorageContext, key: ByteString): void;

/** @syscall System.Runtime.GetScriptContainer */
export declare function runtimeGetScriptContainer(): any;
/** @syscall System.Runtime.CheckWitness */
export declare function runtimeCheckWitness(account: ByteString): boolean;

/** @syscall System.Contract.Call */
export declare function contractCall(scriptHash: ByteString, method: string, flags: number, ...args: any[]): any;

/** @methodToken {0xfffdc93764dbaddd97c48f252a53ea4643faa3fd} update */
export declare function contractManagementUpdate(nefFile: ByteString, manifest: string, data?: any): void;

/** @methodToken {0xfffdc93764dbaddd97c48f252a53ea4643faa3fd} getContract */
export declare function contractManagementGetContract(hash: ByteString): Contract;

// public static extern Contract GetContract(UInt160 hash);

// TODO: Do stack item interfaces such as Transacation and Block need a JSDoc tag like @stackitem?
export interface Transaction {
    readonly hash: ByteString,
    readonly version: number,
    readonly nonce: number,
    readonly sender: ByteString,
    readonly systemFee: bigint,
    readonly networkFee: bigint,
    readonly validUntilBlock: number,
    readonly script: ByteString
}

export interface Block {
    readonly hash: ByteString,
    readonly version: number,
    readonly previousHash: ByteString,
    readonly merkleRoot: ByteString,
    readonly timestamp: bigint,
    readonly nonce: bigint,
    readonly index: number,
    readonly primaryIndex: number,
    readonly nextConsensus: ByteString,
    readonly transactionsCount: number
}

export interface Contract {
    readonly id: number;
    readonly updateCounter: number;
    readonly hash: ByteString;
    readonly nef: ByteString;
    readonly manifest: any;
}


// /** @syscall System.Storage.Find */
// export declare function storageFind(context:StorageContext, prefix: any, options: any): any;


