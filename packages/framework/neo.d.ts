declare global {

    // typescript doesn't differentiate between the symbol for an interface and the symbol for a variable.
    // so I renamed interface ByteString => interface ByteStringInstance for now.
    // this is a crappy dev experience, but it will do for now while I figure out what I want to do to solve this

    export interface ByteStringInstance { 
        readonly length: number; 
        asInteger(): bigint;
    }
    export interface ByteStringConstructor {
        fromString(value: string): ByteStringInstance;
        fromHex(value: string): ByteStringInstance;
        fromInteger(value: number | bigint): ByteStringInstance;
    }
    export const ByteString: ByteStringConstructor;

    // export interface Hash160 { }
    // export interface Hash160Constructor {
    // }
    // export const Hash160: Hash160Constructor;
    // export interface Hash256 { }
    // export interface Hash256Constructor {
    // }
    // export const Hash256: Hash256Constructor;

    // // TODO: move to ByteArray.toInteger
    // /**
    //  * @operation duplicate 
    //  * @operation isnull
    //  * @operation jumpif 3
    //  * @operation convert Integer 
    //  * @operation jump 3
    //  * @operation drop 
    //  * @operation pushint 0
    //  */
    // export function asInteger(value: ByteString | null | undefined): bigint;

    // // TODO: move to ByteArray.fromInteger
    // /**
    //  * @operation convert ByteString
    //  */
    // export function asByteString(value: bigint): ByteString;

    /**
     * @operation concat
     */
    export function concat(value1: StorageType, value2: StorageType): ByteStringInstance;

    export const enum CallFlags {
        None = 0,
        ReadStates = 1,
        WriteStates = 2,
        AllowCall = 4,
        AllowNotify = 8,
        States = 3, // ReadStates | WriteStates
        ReadOnly = 5, // ReadStates | AllowCall
        All = 15, // States | AllowCall | AllowNotify
    }

    export const enum FindOptions {
        None = 0, // No option is set. The results will be an iterator of (key, value).
        KeysOnly = 1, // Indicates that only keys need to be returned. The results will be an iterator of keys.
        RemovePrefix = 2, //Indicates that the prefix byte of keys should be removed before return.
        ValuesOnly = 4, // Indicates that only values need to be returned. The results will be an iterator of values.
        DeserializeValues = 8, // Indicates that values should be deserialized before return.
        PickField0 = 16, // Indicates that only the field 0 of the deserialized values need to be returned. This flag must be set together with <see cref="DeserializeValues"/>.
        PickField1 = 32, // Indicates that only the field 1 of the deserialized values need to be returned. This flag must be set together with <see cref="DeserializeValues"/>.
    }

    export const Storage: StorageConstructor;

    export interface StorageConstructor {
        /** @syscall System.Storage.GetContext */
        readonly context: StorageContext;
        /** @syscall System.Storage.GetReadOnlyContext */
        readonly readonlyContext: ReadonlyStorageContext;
    }

    export type StorageType = ByteStringInstance | string //| Hash160 | Hash256;

    export interface ReadonlyStorageContext {
        /** @syscall System.Storage.Get */
        get(key: StorageType): ByteStringInstance | undefined;
        /** @syscall System.Storage.Find */
        find(prefix: ByteStringInstance, options: FindOptions): Iterator<unknown>
    }

    export interface StorageContext extends ReadonlyStorageContext {
        /** @syscall System.Storage.AsReadOnly */
        readonly asReadonly: ReadonlyStorageContext;
        /** @syscall System.Storage.Put */
        put(key: StorageType, value: StorageType): void;
        /** @syscall System.Storage.Delete */
        delete(key: StorageType): void;
    }

    export const Runtime: RuntimeConstructor;

    export interface RuntimeConstructor {
        /** @syscall System.Contract.GetCallFlags */
        readonly callFlags: CallFlags;

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
        readonly executingScriptHash: ByteStringInstance;
        /** @syscall System.Runtime.GetCallingScriptHash */
        readonly callingScriptHash: ByteStringInstance;
        /** @syscall System.Runtime.GetEntryScriptHash */
        readonly entryScriptHash: ByteStringInstance;
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
    export function checkWitness(account: ByteStringInstance): boolean;
    /** @syscall System.Runtime.BurnGas */
    export function burnGas(amount: bigint): void;
    /** @syscall System.Runtime.Log */
    export function log(message: string): void;
    /** @syscall System.Runtime.Notify*/
    export function notify(eventName: string, state: ReadonlyArray<any>): void;
    /** @syscall System.Runtime.LoadScript*/
    export function loadScript(script: ByteStringInstance, callFlags: CallFlags, args: ReadonlyArray<any>): void;

    export function callContract(scriptHash: ByteStringInstance, method: string, callFlags: CallFlags, ...args: any[]): any;
    /** @syscall System.Contract.CreateStandardAccount */
    export function createStandardAccount(pubKey: ByteStringInstance /*ecpoint*/): ByteStringInstance; // hash160
    /** @syscall System.Contract.CreateMultisigAccount */
    export function createMultisigAccount(count: number, pubKeys: ByteStringInstance[] /*ecpoint*/): ByteStringInstance; // hash160

    /** @syscall System.Crypto.CheckSig */
    export function checkSignature(pubKey: ByteStringInstance, signature: ByteStringInstance): boolean;
    /** @syscall System.Crypto.CheckMultisig */
    export function checkMultiSignature(pubKey: ByteStringInstance[], signature: ByteStringInstance[]): boolean;

    /** @nativeContract {0xfffdc93764dbaddd97c48f252a53ea4643faa3fd} */
    export const ContractManagement: ContractManagementConstructor;

    // TODO: @nativeContract safe methods 
    export interface ContractManagementConstructor {
        /** @nativeContract getMinimumDeploymentFee */
        readonly minimumDeploymentFee: bigint;
        getContract(hash: ByteStringInstance): Contract | undefined;
        hasMethod(hash: ByteStringInstance, method: string, pcount: number): boolean;
        getContractById(id: number): Contract;
        /** @nativeContract getContractHashes */
        readonly contractHashes: Iterator<ByteStringInstance>; // not sure this is correct
        deploy(nefFile: ByteStringInstance, manifest: string, data?: any): Contract;
        update(nefFile: ByteStringInstance, manifest: string, data?: any): void;
        destroy(): void;
    }

    /** @nativeContract {0xacce6fd80d44e1796aa0c2c625e9e4e0ce39efc0} */
    export const StdLib: StdLibConstructor;

    export interface StdLibConstructor {
        atoi(value: string, base?: number): bigint;
        itoa(value: bigint, base?: bigint): string;
        base58CheckDecode(s: string): ByteStringInstance;
        base58CheckEncode(data: ByteStringInstance): string;
        base58Decode(s: string): ByteStringInstance;
        base58Encode(data: ByteStringInstance): string;
        base64Decode(s: string): ByteStringInstance;
        base64Encode(data: ByteStringInstance): string;
        serialize(item: any): ByteStringInstance;
        deserialize(data: ByteStringInstance): any;
        jsonDeserialize(json: ByteStringInstance): any;
        jsonSerialize(item: any): ByteStringInstance;
        memoryCompare(str1: ByteStringInstance, str2: ByteStringInstance): number;
        memorySearch(mem: ByteStringInstance, value: ByteStringInstance, start?: number, backward?: boolean): number;
        stringSplit(str: string, separator: string, removeEmptyEntries?: boolean): string[];
    }

    /** @nativeContract {0x726cb6e0cd8628a1350a611384688911ab75f51b} */
    export const CryptoLib: CryptoLibConstructor;

    export interface CryptoLibConstructor {
        murmur32(data: ByteStringInstance, seed: number): ByteStringInstance;
        ripemd160(data: ByteStringInstance): ByteStringInstance;
        sha256(data: ByteStringInstance): ByteStringInstance;
        verifyWithECDsa(message: ByteStringInstance, pubkey: ByteStringInstance, signature: ByteStringInstance, curve: number): boolean;
    }

    // for verifyWithECDsa curve param
    export const secp256k1 = 22;
    export const secp256r1 = 23;


    /** @nativeContract {0xda65b600f7124ce6c79950c1772a36403104f2be} */
    export const Ledger: LedgerConstructor;

    export interface LedgerConstructor {
        readonly currentHash: ByteStringInstance;
        readonly currentIndex: number;
        getBlock(indexOrHash: number | ByteStringInstance): Block;
        getTransaction(hash: ByteStringInstance): Transaction;
        getTransactionFromBlock(blockIndexOrHash: number | ByteStringInstance, txIndex: number): Transaction;
        getTransactionHeight(hash: ByteStringInstance): number;
        getTransactionSigners(hash: ByteStringInstance): Signer[];
        getTransactionVMState(hash: ByteStringInstance): number;
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
        unclaimedGas(account: ByteStringInstance, end: number): bigint;
        registerCandidate(pubkey: ByteStringInstance): boolean;
        unregisterCandidate(pubkey: ByteStringInstance): boolean;
        vote(account: ByteStringInstance, voteTo: ByteStringInstance): boolean;

        /** @nativeContract getCandidates */
        readonly candidates: [ByteStringInstance, bigint][];
        /** @nativeContract getAllCandidates */
        readonly allCandidates: Iterator<[ByteStringInstance, bigint]>;

        getCandidateVote(pubKey: ByteStringInstance): bigint;
        /** @nativeContract getCommittee */
        readonly committee: ByteStringInstance[];
        /** @nativeContract getNextBlockValidators */
        readonly nextBlockValidators: ByteStringInstance[];

        getAccountState(account: ByteStringInstance): NeoAccountState[];
    }

    /** @nativeContract {0xd2a4cff31913016155e38e474a2c06d08be276cf} */
    export const GasToken: FungibleTokenConstructor;

    export interface FungibleTokenConstructor {
        readonly decimals: number;
        readonly symbol: string;
        readonly totalSupply: bigint;
        balanceOf(account: ByteStringInstance): bigint;
        transfer(from: ByteStringInstance, to: ByteStringInstance, amount: bigint, data?: any): boolean;
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
        isBlocked(account: ByteStringInstance): boolean;
    }

    /** @nativeContract {0x49cf4e5378ffcd4dec034fd98a174c5491e395e2} */
    export const RoleManagement: RoleManagementConstructor;

    export interface RoleManagementConstructor {
        getDesignatedByRole(role: number, index: number): ByteStringInstance[];
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
        readonly hash: ByteStringInstance,
        readonly version: number,
        readonly nonce: number,
        readonly sender: ByteStringInstance,
        readonly systemFee: bigint,
        readonly networkFee: bigint,
        readonly validUntilBlock: number,
        readonly script: ByteStringInstance
    }

    /** @stackitem */
    export interface Block {
        readonly hash: ByteStringInstance,
        readonly version: number,
        readonly previousHash: ByteStringInstance,
        readonly merkleRoot: ByteStringInstance,
        readonly timestamp: bigint,
        readonly nonce: bigint,
        readonly index: number,
        readonly primaryIndex: number,
        readonly nextConsensus: ByteStringInstance,
        readonly transactionsCount: number
    }

    /** @stackitem */
    export interface Contract {
        readonly id: number;
        readonly updateCounter: number;
        readonly hash: ByteStringInstance;
        readonly nef: ByteStringInstance;
        readonly manifest: ContractManifest;
    }

    /** @stackitem */
    export interface ContractManifest {
        readonly name: string;
        readonly groups: any; // ContractGroup[] 
        readonly reserved: any;
        readonly supportedStandards: any; //string[]
        readonly abi: ContractAbi;
        readonly permissions: any; //ContractPermission[]
        readonly trusts: any; //ByteString[]
        readonly extra: string;
    }

    /** @stackitem */
    export interface ContractAbi {
        readonly methods: readonly ContractMethodDescriptor[];
        readonly events: readonly ContractEventDescriptor[];
    }

    /** @stackitem */
    export interface ContractMethodDescriptor {
        readonly name: string;
        readonly parameters: readonly ContractParameterDefinition[];
    }

    /** @stackitem */
    export interface ContractEventDescriptor {
        readonly name: string;
        readonly parameters: readonly ContractParameterDefinition[];
        readonly returnType: number;
        readonly offset: number;
        readonly safe: boolean;
    }

    /** @stackitem */
    export interface ContractParameterDefinition {
        readonly name: string;
        readonly type: number;
    }


    /** @stackitem */
    export interface Notification {
        readonly hash: ByteStringInstance;
        readonly eventName: string;
        readonly state: ReadonlyArray<any>;
    }

    /** @stackitem */
    export interface Signer {
        readonly account: ByteStringInstance;
        readonly scopes: number;
        readonly allowedContracts: ByteStringInstance[];
        readonly alowedGroups: ByteStringInstance[];
        // readonly rules: any[];
    }

    /** @stackitem */
    export interface NeoAccountState {
        readonly balance: bigint,
        readonly height: number,
        readonly voteTo: ByteStringInstance
    }

}

export { }