import { ContractType, PrimitiveType, StructContractType } from "./contractType";

export interface DebugInfo {
    version: number;
    checksum: string;
    scriptHash: string;
    documents: string[];
    methods: Method[];
    events: Event[];
    staticVariables: SlotVariable[];
    structs: StructContractType[];
    storageGroups: StorageGroupDef[];
}

export interface Method {
    namespace: string;
    name: string;
    range: { start: number, end: number };
    returnType: ContractType | undefined;
    parameters: SlotVariable[];
    variables: SlotVariable[];
    sequencePoints: SequencePoints[];
}

export interface Event {
    namespace: string;
    name: string;
    parameters: SlotVariable[];
}

export interface SlotVariable {
    name: string;
    type: ContractType;
    index: number;
 }

export interface KeySegment {
    name: string;
    type: PrimitiveType;
} 

export interface StorageGroupDef { 
    name: string;
    keyPrefix: Uint8Array;
    keySegments: KeySegment;
    valueType: ContractType;
}

export interface SequencePoints {
    address: number;
    document: number;
    start: { line: number, column: number };
    end: { line: number, column: number };
}
