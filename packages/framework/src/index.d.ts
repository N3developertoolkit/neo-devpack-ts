
// There are 9 NeoVM Types: Pointer, Boolean, Integer, ByteString, Buffer, Array, Struct, Map, InteropInterface
//  * five types have direct TS equivalents: Boolean/boolean, Integer/bigint, Buffer/Uint8Array, Array/Array, Map/Map
//  * ByteString is defined as ReadonlyUint8Array as per https://www.growingwiththeweb.com/2020/10/typescript-readonly-typed-arrays.html
//  * Pointer, Struct and InteropInterface are all TBD

export interface ByteString extends Omit<Uint8Array, 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort'> { }

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

export interface StorageContext {}

/** @syscall System.Storage.GetContext */ 
export declare function storageGetContext(): StorageContext;
/** @syscall System.Storage.GetReadOnlyContext */ 
export declare function storageGetReadOnlyContext(): StorageContext;
/** @syscall System.Storage.AsReadOnly */ 
export declare function storageAsReadOnly(context:StorageContext): StorageContext;
/** @syscall System.Storage.Get */ 
export declare function storageGet(context:StorageContext, key: ByteString): ByteString;
/** @syscall System.Storage.Put */ 
export declare function storagePut(context:StorageContext, key: ByteString, value: ByteString): void;
/** @syscall System.Storage.Delete */ 
export declare function storageDelete(context:StorageContext, key: ByteString):void;
// /** @syscall System.Storage.Find */ 
// export declare function storageFind(context:StorageContext, prefix: any, options: any): any;
