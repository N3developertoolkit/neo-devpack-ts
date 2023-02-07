// import path from "path";
// import { ContractType, PrimitiveType, StructContractType, toString as contractTypeToString } from "./ContractType";
// import { join } from 'path';
import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";

export interface DebugInfo {
    methods?: DebugMethod[];
    // events?: Event[];
}

export interface DebugMethod {
    id: string,
    name: string;
    range: { start: number, end: number };
    parameters?: SlotVariable[];
    variables?: SlotVariable[];
    returnType?: sc.ContractParamType;
    sequencePoints?: SequencePoint[];
}

// export interface Event {
//     name: string;
//     parameters?: SlotVariable[];
// }

export interface SlotVariable {
    name: string;
    type: sc.ContractParamType;
    index?: number;
}

// export interface Struct {
//     name: string,
//     fields: {
//         name: string,
//         type: ContractType
//     }[]
// }

// export interface StorageGroupDef {
//     name: string;
//     type: ContractType;
//     keyPrefix: Uint8Array;
//     keySegments: {
//         name: string;
//         type: PrimitiveType;
//     }[];
// }

export interface SequencePoint {
    address: number;
    location: tsm.Node,
}

// export interface DebugInfoJson {
//     version: undefined | 2,
//     hash: string; // hex-encoded UInt160
//     checksum: number;
//     documents?: string[]; // file paths
//     events?: {
//         id: string;
//         name: string;
//         params?: string[];
//     }[];
//     methods?: {
//         id?: string;
//         name: string;
//         range: string; // format: "{start-address}-{end-address}
//         params?: string[];
//         "return"?: string;
//         variables?: string[];
//         "sequence-points"?: string[]; // format: "{address}[{document-index}]{start-line}:{start-column}-{end-line}:{end-column}"
//     }[];
//     "static-variables"?: string[];
// }

// export function toJson(info: DebugInfo, nef: sc.NEF, sourceDir?: string): DebugInfoJson {
//     const documentSet = [...new Set(info.methods
//         ?.flatMap(m => m.sequencePoints ?? [])
//         .map(sp => sp.location.getSourceFile()) ?? [])
//         .values()];

//     const documentMap = new Map(documentSet.map((v, i) => [v, i]));
//     const documents = documentSet
//         .map(d => {
//             const path = d.getFilePath();
//             return sourceDir 
//                 ? join(sourceDir, path) 
//                 : path
//         });

//     const methods = info.methods?.map(m => {
//         return {
//             name: `,${m.name}`,
//             range: `${m.range.start}-${m.range.end}`,
//             params: m.parameters?.map((p, i) => `${p.name},${contractTypeToString(p.type)},${i}`),
//             "return": m.returnType ? contractTypeToString(m.returnType) : undefined,
//             variables: m.variables?.map(v => `${v.name},${contractTypeToString(v.type)},${v.index!}`),
//             "sequence-points": m.sequencePoints?.map(sp => {
//                 const { address, location: node } = sp;
//                 const src = node.getSourceFile();
//                 const start = src.getLineAndColumnAtPos(node.getStart());
//                 const end = src.getLineAndColumnAtPos(node.getEnd());
//                 const index = documentMap.get(src)!;
//                 return `${address}[${index}]${start.line}:${start.column}-${end.line}:${end.column}`
//             })
//         }
//     })

//     const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();
//     const json: DebugInfoJson = {
//         version: 2,
//         hash: `0x${hash.toString('hex')}`,
//         checksum: nef.checksum,
//         documents,
//         methods
//     }
//     return json;
// }
