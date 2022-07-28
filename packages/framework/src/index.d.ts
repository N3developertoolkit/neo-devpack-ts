export interface StorageContext { }

export type StorageKey = Uint8Array | string;
 
export const Storage: StorageConstructor;

export interface StorageConstructor {
    // @syscall("System.Storage.GetContext")
    readonly currentContext: StorageContext;
    // @syscall("System.Storage.Get")
    get(context: StorageContext, key: StorageKey): string;
    // @syscall("System.Storage.Put")
    put(context: StorageContext, key: StorageKey, value: string): void;
}
