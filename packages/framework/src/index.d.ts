export class SmartContract {}

export interface StorageContext { }

export type StorageKey = Uint8Array | ArrayLike<number> | string;
 
export function getCurrentContext(): StorageContext;
export function getStorage(context: StorageContext, key: StorageKey): string;
export function putStorage(context: StorageContext, key: StorageKey, value: string);

export interface StorageInterface {
    readonly currentContext: StorageContext;
    get(context: StorageContext, key: StorageKey): string;
    put(context: StorageContext, key: StorageKey, value: string);
}

declare const Storage: StorageInterface;

// export class Storage {
//     public static readonly currentContext: StorageContext;
//     public static get(context: StorageContext, key: StorageKey): string;
//     public static put(context: StorageContext, key: StorageKey, value: string): void;
// }