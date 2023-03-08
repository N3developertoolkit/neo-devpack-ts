
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
        readonly entryScriptHash: ByteString;
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
    export function checkMultiSignature(pubKey: ByteString[], signature: ByteString[]): boolean;

    /** @nativeContract {0xfffdc93764dbaddd97c48f252a53ea4643faa3fd} */
    export const ContractManagement: ContractManagementConstructor;

    export interface ContractManagementConstructor {
        /** @nativeContract getMinimumDeploymentFee */
        readonly minimumDeploymentFee: bigint;
        getContract(hash: ByteString): Contract;
        hasMethod(hash: ByteString, method: string, pcount: number): boolean;
        getContractById(id: number): Contract;
        // /** @nativeContract getContractHashes */
        // readonly contractHashes: InteropInterface; // TODO: iterators
        deploy(nefFile: ByteString, manifest: string, data?: any): Contract;
        update(nefFile: ByteString, manifest: string, data?: any): void;
        destroy(): void;
    }

    /** @nativeContract {0xacce6fd80d44e1796aa0c2c625e9e4e0ce39efc0} */
    export const StdLib: StdLibConstructor;

    export interface StdLibConstructor {
        atoi(value: string, base?: number): bigint;
        itoa(value: bigint, base?: bigint): string;
        base58CheckDecode(s: string): ByteString;
        base58CheckEncode(data: ByteString): string;
        base58Decode(s: string): ByteString;
        base58Encode(data: ByteString): string;
        base64Decode(s: string): ByteString;
        base64Encode(data: ByteString): string;
        serialize(item: any): ByteString;
        deserialize(data: ByteString): any;
        jsonDeserialize(json: ByteString): any;
        jsonSerialize(item: any): ByteString;
        memoryCompare(str1: ByteString, str2: ByteString): number;
        memorySearch(mem: ByteString, value: ByteString, start?: number, backward?: boolean): number;
        stringSplit(str: string, separator: string, removeEmptyEntries?: boolean): string[];
    }

    /** @nativeContract {0x726cb6e0cd8628a1350a611384688911ab75f51b} */
    export const CryptoLib: CryptoLibConstructor;

    export interface CryptoLibConstructor {
        murmur32(data: ByteString, seed: number): ByteString;
        ripemd160(data: ByteString): ByteString;
        sha256(data: ByteString): ByteString;
        verifyWithECDsa(message: ByteString, pubkey: ByteString, signature: ByteString, curve: number): boolean;
    }

    // for verifyWithECDsa curve param
    export const secp256k1 = 22;
    export const secp256r1 = 23;


    /** @nativeContract {0xda65b600f7124ce6c79950c1772a36403104f2be} */
    export const Ledger: LedgerConstructor;

    export interface LedgerConstructor {
        readonly currentHash: ByteString;
        readonly currentIndex: number;
        getBlock(indexOrHash: number | ByteString): Block;
        getTransaction(hash: ByteString): Transaction;
        getTransactionFromBlock(blockIndexOrHash: number | ByteString, txIndex: number): Transaction;
        getTransactionHeight(hash: ByteString): number;
        getTransactionSigners(hash: ByteString): Signer[];
        getTransactionVMState(hash: ByteString): number;
    }

    // for getTransactionVMState return value
    export const NONE = 0;
    export const HALT = 1;
    export const FAULT = 2;
    export const BREAK = 4;


    /** @nativeContract {0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5} */
    export const NeoToken: NeoTokenConstructor;

    export interface NeoTokenConstructor extends FungibleTokenConstructor {
        /** @nativeContract getGasPerBlock */
        readonly gasPerBlock: bigint;
        /** @nativeContract getRegisterPrice */
        readonly registerPrice: bigint;
        unclaimedGas(account: ByteString, end: number): bigint;
        registerCandidate(pubkey: ByteString): boolean;
        unregisterCandidate(pubkey: ByteString): boolean;
        vote(account: ByteString, voteTo: ByteString): boolean;

        /** @nativeContract getCandidates */
        readonly candidates: any[]; //(ECPoint, BigInteger)[]
        // /** @nativeContract getAllCandidates */
        // readonly allCandidates: Iterator;

        getCandidateVote(pubKey: ByteString): bigint;
        /** @nativeContract getCommittee */
        readonly committee: ByteString[];
        /** @nativeContract getNextBlockValidators */
        readonly nextBlockValidators: ByteString[];

        getAccountState(account: ByteString): NeoAccountState[];
    }

    /** @nativeContract {0xd2a4cff31913016155e38e474a2c06d08be276cf} */
    export const GasToken: FungibleTokenConstructor;

    export interface FungibleTokenConstructor {
        readonly decimals: number;
        readonly symbol: string;
        readonly totalSupply: bigint;
        balanceOf(account: ByteString): bigint;
        transfer(from: ByteString, to: ByteString, amount: bigint, data?: any): boolean;
    }

    /** @nativeContract {0xcc5e4edd9f5f8dba8bb65734541df7a1c081c67b} */
    export const Policy: PolicyConstructor;

    export interface PolicyConstructor {
        /** @nativeContract getFeePerByte */
        readonly feePerByte: number;
        /** @nativeContract getExecFeeFactor */
        readonly execFeeFactor: number;
        /** @nativeContract getStoragePrice */
        readonly storagePrice: number;
        isBlocked(account: ByteString): boolean;
    }

    /** @nativeContract {0x49cf4e5378ffcd4dec034fd98a174c5491e395e2} */
    export const RoleManagement: RoleManagementConstructor;

    export interface RoleManagementConstructor {
        getDesignatedByRole(role: number, index: number): ByteString[];
    }

    // for getDesignatedByRole role param
    export const stateValidator = 4;
    export const oracle = 8;

    /** @nativeContract {0xfe924b7cfe89ddd271abaf7210a80a7e11178758} */
    export const Oracle: OracleConstructor;

    export interface OracleConstructor {
        /** @nativeContract getPrice */
        readonly price: bigint;
        request(url: string, filter: string, callback: string, userData: any, gasForResponse: bigint): void;
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

    /** @stackitem */
    export interface Signer {
        readonly account: ByteString;
        readonly scopes: number;
        readonly allowedContracts: ByteString[];
        readonly alowedGroups: ByteString[];
        // readonly rules: any[];
    }

    /** @stackitem */
    export interface NeoAccountState {
        readonly balance: bigint,
        readonly height: number,
        readonly voteTo: ByteString
    }

}

export { }