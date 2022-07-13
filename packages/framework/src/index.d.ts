export class SmartContract {}

export interface StorageContext { }
 
export interface StorageInterface {
    readonly currentContext: StorageContext;
    get(context: StorageContext, key: Uint8Array | string | ArrayLike<number>): any;
}


declare const Storage: StorageInterface;
