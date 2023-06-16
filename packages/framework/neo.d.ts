/// <reference no-default-lib="true"/>
/// <reference lib="es2020" />

declare global {

    export interface ByteString { 
        readonly length: number; 
        asInteger(): bigint;
    }

    export interface ByteStringConstructor {
        fromString(value: string): ByteString;
        fromHex(value: string): ByteString;
        fromInteger(value: number | bigint): ByteString;
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

    export function concat(value1: StorageType, value2: StorageType): ByteString;

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
        readonly context: StorageContext;
        readonly readonlyContext: ReadonlyStorageContext;
    }

    export type StorageType = ByteString | string //| Hash160 | Hash256;

    export interface ReadonlyStorageContext {
        get(key: StorageType): ByteString | undefined;
        find(prefix: ByteString, options: FindOptions): IterableIterator<unknown>;

        // the following three methods map to StorageContext.Find, with what I would argue are the most common
        // combinations of Flag Options:

        // with and without RemovePrefix. Default to removing the prefix
        entries(prefix?: ByteString, keepPrefix?: boolean): IterableIterator<[ByteString, ByteString]>;
        // KeysOnly with and without RemovePrefix, Default to removing the prefix
        keys(prefix?: ByteString, keepPrefix?: boolean): IterableIterator<ByteString>;
        // ValuesOnly
        values(prefix?: ByteString): IterableIterator<ByteString>;

        // this interface will need a mechanism for surfacing the DeserializeValues option.
        // for now, author can simply call StdLib.deserialize, but that's a pricy call to execute
        // for every item in the iterator when using the DeserializeValues option does it for free.

        // not sure if PickField0/1 are really that useful.
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
        readonly notifications: readonly Notification[];
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
    export function notify(eventName: string, state: readonly any[]): void;
    /** @syscall System.Runtime.LoadScript*/
    export function loadScript(script: ByteString, callFlags: CallFlags, args: readonly any[]): void;
    /** @syscall System.Contract.CreateStandardAccount */
    export function createStandardAccount(pubKey: ByteString /*ecpoint*/): ByteString; // hash160
    /** @syscall System.Contract.CreateMultisigAccount */
    export function createMultisigAccount(count: number, pubKeys: ByteString[] /*ecpoint*/): ByteString; // hash160
    /** @syscall System.Crypto.CheckSig */
    export function checkSignature(pubKey: ByteString, signature: ByteString): boolean;
    /** @syscall System.Crypto.CheckMultisig */
    export function checkMultiSignature(pubKey: ByteString[], signature: ByteString[]): boolean;

    // callContract has special argument handling, so it doesn't use the same built-in infrastructure 
    // as other @syscall functions 
    export function callContract(scriptHash: ByteString, method: string, callFlags: CallFlags, ...args: any[]): any;


    /** @nativeContract {0xfffdc93764dbaddd97c48f252a53ea4643faa3fd} */
    export const ContractManagement: ContractManagementConstructor;

    // TODO: @nativeContract safe methods 
    export interface ContractManagementConstructor {
        /** @nativeContract getMinimumDeploymentFee */
        readonly minimumDeploymentFee: bigint;
        getContract(hash: ByteString): Contract | undefined;
        hasMethod(hash: ByteString, method: string, pcount: number): boolean;
        getContractById(id: number): Contract;
        /** @nativeContract getContractHashes */
        readonly contractHashes: IterableIterator<ByteString>; // not sure this is correct
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

    export const enum ECDsaCurve {
        secp256k1 = 22,
        secp256r1 = 23,
    }

    export interface CryptoLibConstructor {
        murmur32(data: ByteString, seed: number): ByteString;
        ripemd160(data: ByteString): ByteString;
        sha256(data: ByteString): ByteString;
        verifyWithECDsa(message: ByteString, pubkey: ByteString, signature: ByteString, curve: ECDsaCurve): boolean;
    }

    /** @nativeContract {0xda65b600f7124ce6c79950c1772a36403104f2be} */
    export const Ledger: LedgerConstructor;

    export const enum VMState {
        NONE = 0,
        HALT = 1,
        FAULT = 2,
        BREAK = 4,
    }

    export interface LedgerConstructor {
        readonly currentHash: ByteString;
        readonly currentIndex: number;
        getBlock(indexOrHash: number | ByteString): Block;
        getTransaction(hash: ByteString): Transaction;
        getTransactionFromBlock(blockIndexOrHash: number | ByteString, txIndex: number): Transaction;
        getTransactionHeight(hash: ByteString): number;
        getTransactionSigners(hash: ByteString): Signer[];
        getTransactionVMState(hash: ByteString): VMState;
    }

    export interface FungibleTokenConstructor {
        readonly decimals: number;
        readonly symbol: string;
        readonly totalSupply: bigint;
        balanceOf(account: ByteString): bigint;
        transfer(from: ByteString, to: ByteString, amount: bigint, data?: any): boolean;
    }

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
        readonly candidates: [ByteString, bigint][];
        /** @nativeContract getAllCandidates */
        readonly allCandidates: IterableIterator<[ByteString, bigint]>;

        getCandidateVote(pubKey: ByteString): bigint;
        /** @nativeContract getCommittee */
        readonly committee: ByteString[];
        /** @nativeContract getNextBlockValidators */
        readonly nextBlockValidators: ByteString[];

        getAccountState(account: ByteString): NeoAccountState[];
    }

    /** @nativeContract {0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5} */
    export const NeoToken: NeoTokenConstructor;

    /** @nativeContract {0xd2a4cff31913016155e38e474a2c06d08be276cf} */
    export const GasToken: FungibleTokenConstructor;

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

    export const enum Role {
        StateValidator = 4,
        Oracle = 8,
        NeoFSAlphabetNode = 16,
    }

    export interface RoleManagementConstructor {
        getDesignatedByRole(role: Role, index: number): ByteString[];
    }

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
        readonly hash: ByteString;
        readonly eventName: string;
        readonly state: readonly any[];
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