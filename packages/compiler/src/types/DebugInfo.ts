import { ContractType, PrimitiveType, StructContractType } from "./ContractType";

export interface DebugInfo {
    contractHash: string,
    checksum: number,
    methods?: Method[];
    events?: Event[];
    staticVariables?: SlotVariable[];
    structs?: StructContractType[];
    storageGroups?: StorageGroupDef[];
}

export interface Method {
    name: string;
    range: { start: number, end: number };
    parameters?: SlotVariable[];
    variables?: SlotVariable[];
    returnType?: ContractType;
    sequencePoints?: SequencePoint[];
}

export interface Event {
    name: string;
    parameters?: SlotVariable[];
}

export interface SlotVariable {
    name: string;
    type: ContractType;
    index?: number;
}

export interface Struct {
    name: string,
    fields: {
        name: string,
        type: ContractType
    }[]
}

export interface StorageGroupDef {
    name: string;
    type: ContractType;
    keyPrefix: Uint8Array;
    keySegments: {
        name: string;
        type: PrimitiveType;
    }[];
}

export interface SequencePoint {
    address: number;
    document: string;
    start: { line: number, column: number };
    end: { line: number, column: number };
}
