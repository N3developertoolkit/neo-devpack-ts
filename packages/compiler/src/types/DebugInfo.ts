import { ContractType, PrimitiveType, StructContractType, toString as contractTypeToString } from "./ContractType";

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

export interface DebugInfoJson {
    hash: string; // hex-encoded UInt160
    documents?: string[]; // file paths
    events?: {
        id: string;
        name: string;
        params?: string[];
    }[];
    methods?: {
        id?: string;
        name: string;
        range: string; // format: "{start-address}-{end-address}
        params?: string[];
        "return"?: string;
        variables?: string[];
        "sequence-points"?: string[]; // format: "{address}[{document-index}]{start-line}:{start-column}-{end-line}:{end-column}"
    }[];
    "static-variables"?: string[];
}

export function toJson(info: DebugInfo): DebugInfoJson {
    const documents = [...new Set(info.methods
        ?.flatMap(m => m.sequencePoints ?? [])
        .map(sp => sp.document) ?? [])];
    const documentMap = new Map(documents.map((v,i) => [v, i]));

    const methods = info.methods?.map(m => {
        return {
            name: m.name,
            range: `${m.range.start}-${m.range.end}`,
            params: m.parameters?.map((p,i) => `${p.name},${contractTypeToString(p.type)},${i}`),
            "return": m.returnType ? contractTypeToString(m.returnType) : undefined,
            "sequence-points": m.sequencePoints?.map(sp => {
                const index = documentMap.get(sp.document)!;
                return `${sp.address}[${index}]${sp.start.line}:${sp.start.column}-${sp.end.line}:${sp.end.column}`
            })
        }
    })

    const json: DebugInfoJson = {
        hash: info.contractHash,
        documents,
        methods
    }
    return json;
}

