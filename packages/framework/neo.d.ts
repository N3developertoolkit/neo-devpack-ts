
// There are 9 NeoVM Types: Pointer, Boolean, Integer, ByteString, Buffer, Array, Struct, Map, InteropInterface
//  * five types have direct TS equivalents: Boolean/boolean, Integer/bigint, Buffer/Uint8Array, Array/Array, Map/Map
//  * ByteString is defined as ReadonlyUint8Array as per https://www.growingwiththeweb.com/2020/10/typescript-readonly-typed-arrays.html
//  * Pointer, Struct and InteropInterface are all TBD

declare global {
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
    export function asInteger(value: ByteString | null | undefined): bigint;

    /**
     * @operation convert ByteString
     */
    export function asByteString(value: bigint): ByteString;

    /**
     * @operation concat
     */
    export function concat(value1: ByteString, value2: ByteString): ByteString;

    export const callFlagsNone = 0;
    export const callFlagsReadStates = 1;
    export const callFlagsWriteStates = 2;
    export const callFlagsAllowCall = 4;
    export const callFlagsAllowNotify = 8;
    export const callFlagsStates = 3;
    export const callFlagsReadOnly = 5;
    export const callFlagsAll = 15

	// Contract service:
    // 		three methods are internal use only: CallNative, NativeOnPersist and NativePostPersist
    // 		one has no params: GetCallFlags - project as Runtime object property 
    // 		remainder are projected as functions : Call, CreateStandardAccount, CreateMultisigAccount
    // Crypto service
    // 		both project as functions: CheckSig and CheckMultisig
	// Iterator service: TBD
	// Runtime Service
	// 		13 are projected as readonly properties on Runtime object (plus GetCallFlags from Contract Service)
    //      		GetTrigger, Platform, GetScriptContainer, GetExecutingScriptHash, GetCallingScriptHash, 
    //      		GetEntryScriptHash, GetTime, GetInvocationCounter, GasLeft, GetAddressVersion
    //      		GetNetwork, GetRandom, GetNotifications
	//		remaining 5 are projected as functions: CheckWitness, Log, Notify, LoadScript, BurnGas
	// Storage Service
	//		This one is tricky, as the most *natural and familiar* projection is as a Storage Context object w/ instance methods

	
    export const Storage: StorageConstructor;

    export interface StorageConstructor {
        /** @syscall System.Storage.GetContext */
        readonly context: StorageContext;
        /** @syscall System.Storage.GetReadOnlyContext */
        readonly readonlyContext: ReadonlyStorageContext;
    }

    export interface ReadonlyStorageContext {
        /** @syscall System.Storage.Get */
        get(key: ByteString): ByteString | undefined;
        // /** @syscall System.Storage.Find */
        // find(prefix: ByteString, options: FindOptions): Iterator
    }

    export interface StorageContext extends ReadonlyStorageContext {
        /** @syscall System.Storage.AsReadOnly */
        readonly asReadonly: ReadonlyStorageContext;
        /** @syscall System.Storage.Put */
        put(key: ByteString, value: ByteString): void;
        /** @syscall System.Storage.Delete */
        delete(key: ByteString): void;
    }

    // FindOptions
    // None = 0,                    No option is set. The results will be an iterator of (key, value).
    // KeysOnly = 1 << 0,           Indicates that only keys need to be returned. The results will be an iterator of keys.
    // RemovePrefix = 1 << 1,       Indicates that the prefix byte of keys should be removed before return.
    // ValuesOnly = 1 << 2,         Indicates that only values need to be returned. The results will be an iterator of values.
    // DeserializeValues = 1 << 3,  Indicates that values should be deserialized before return.
    // PickField0 = 1 << 4,         Indicates that only the field 0 of the deserialized values need to be returned. This flag must be set together with <see cref="DeserializeValues"/>.
    // PickField1 = 1 << 5,         Indicates that only the field 1 of the deserialized values need to be returned. This flag must be set together with <see cref="DeserializeValues"/>.

    export const Runtime: RuntimeConstructor;
    
    export interface RuntimeConstructor {
		/** @syscall System.Contract.GetCallFlags */ 
		readonly callFlags: number;

		/** @syscall System.Runtime.Platform */
		readonly platform: string;
		/** @syscall System.Runtime.GetNetwork */
		readonly network: number;
		/** @syscall System.Runtime.GetAddressVersion */
		readonly addressVersion: number;
		/** @syscall System.Runtime.GetTrigger */
		readonly trigger: number;
		/** @syscall System.Runtime.GetTime */
		readonly time: bigint;
        /** @syscall System.Runtime.GetScriptContainer */
		readonly scriptContainer: any;
		/** @syscall System.Runtime.GetExecutingScriptHash */
		readonly executingScriptHash: ByteString;
		/** @syscall System.Runtime.GetCallingScriptHash */
		readonly callingScriptHash: ByteString;
		/** @syscall System.Runtime.GetEntryScriptHash */
		readonly entryScriptHash : ByteString;
		/** @syscall System.Runtime.GetInvocationCounter */
		readonly invocationCounter: number;
		/** @syscall System.Runtime.GetRandom */
		readonly random: bigint;
		/** @syscall System.Runtime.GetNotifications */
		readonly notifications: ReadonlyArray<Notification>;
		/** @syscall System.Runtime.GasLeft */
		readonly remainingGas: bigint;
    }

    /** @syscall System.Runtime.CheckWitness */
    export function checkWitness(account: ByteString): boolean;
    /** @syscall System.Runtime.BurnGas */
    export function burnGas(amount: bigint): void;
    /** @syscall System.Runtime.Log */
    export function log(message: string): void;
    /** @syscall System.Runtime.Notify*/
    export function notify(eventName: string, state: ReadonlyArray<any>): void;
    /** @syscall System.Runtime.LoadScript*/
    export function loadScript(script: ByteString, callFlags: number, args: ReadonlyArray<any>): void;
    
    /** @syscall System.Contract.Call */
    export function callContract(scriptHash: ByteString, method: string, flags: number, ...args: any[]): any;
	/** @syscall System.Contract.GetCallFlags*/
	export function getCallFlags(): number;
    /** @syscall System.Contract.CreateStandardAccount */
    export function createStandardAccount(pubKey: ByteString /*ecpoint*/): ByteString; // hash160
    /** @syscall System.Contract.CreateMultisigAccount */
    export function createMultisigAccount(count: number, pubKeys: ByteString[] /*ecpoint*/): ByteString; // hash160

    /** @syscall System.Crypto.CheckSig */
    export function checkSignature(pubKey: ByteString, signature: ByteString): boolean;
	/** @syscall System.Crypto.CheckMultisig */
    export function checkMultiSignature (pubKey: ByteString[], signature: ByteString[]): boolean;


    /** @nativeContract {0xfffdc93764dbaddd97c48f252a53ea4643faa3fd} */
    export const ContractManagement: ContractManagementConstructor;

    export interface ContractManagementConstructor {
        getMinimumDeploymentFee(): bigint; // prop?
        setMinimumDeploymentFee(value: bigint): void;
        getContract(hash: ByteString): Contract;
        getContractById(id: number): Contract;
		// GetContractHashes - needs iterator support
		hasMethod(hash: ByteString, method: string, pcount: number): boolean;
		deploy(nefFile: ByteString, manifest: string, data?: any): Contract;
        update(nefFile: ByteString, manifest: string, data?: any): void;
    }
    
    /**  @nativeContract {0x726cb6e0cd8628a1350a611384688911ab75f51b} */
    export const CryptoLib: CryptoLibConstructor;
    
    export interface CryptoLibConstructor {
		ripemd160(data: ByteString): ByteString;
		sha256(data: ByteString): ByteString;
		murmur32(data: ByteString, seed: number): ByteString;
		verifyWithECDsa(message: ByteString, pubkey: ByteString, signature: ByteString, curve: number): boolean
	}
    
    export const secp256k1 = 22;
    export const secp256r1 = 23;
    
    export interface FungibleTokenConstructor {
		readonly symbol: string;
		readonly decimals: number;
		readonly totalSupply: bigint;
		balanceOf(account: ByteString): bigint;
		transfer(from: ByteString, to: ByteString, amount: bigint, data: any): boolean
    }


    /** @stackitem */
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

    /** @stackitem */
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

    /** @stackitem */
    export interface Contract {
        readonly id: number;
        readonly updateCounter: number;
        readonly hash: ByteString;
        readonly nef: ByteString;
        readonly manifest: any;
    }
    
    /** @stackitem */
    export interface Notification {
		readonly hash: ByteString;
        readonly eventName: string;
        readonly state: ReadonlyArray<any>;
    }
}

export { }