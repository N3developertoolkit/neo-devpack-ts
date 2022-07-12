export class SmartContract {}

export interface StorageContext { }
 
export interface StorageInterface {
    readonly currentContext: StorageContext;
    get(context: StorageContext, key: any): any;
}

declare const Storage: StorageInterface;
