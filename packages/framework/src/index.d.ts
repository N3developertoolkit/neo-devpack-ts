export class SmartContract {}

export interface StorageContext { }

export type StorageKey = Uint8Array | ArrayLike<number> | string;
 
export interface StorageInterface {
    readonly currentContext: StorageContext;
    get(context: StorageContext, key: StorageKey): string;
    put(context: StorageContext, key: StorageKey, value: string);
}

declare const Storage: StorageInterface;
