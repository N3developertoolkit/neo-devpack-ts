// import path from "path";
// import { ContractType, PrimitiveType, StructContractType, toString as contractTypeToString } from "./ContractType";
// import { join } from 'path';
import { sc, u } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { Location } from "./Operation";
import { pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROS from 'fp-ts/ReadonlySet'
import * as FP from 'fp-ts'
import { asContractParamType, asReturnType } from "../collectArtifacts";

export interface SlotVariable {
    name: string;
    type: tsm.Type;
    index: number;
}

export interface SequencePoint {
    address: number;
    location: Location,
}

export interface DebugInfoMethod {
    readonly name: string,
    readonly range: { readonly start: number, readonly end: number },
    readonly parameters: ReadonlyArray<SlotVariable>;
    readonly returnType: tsm.Type,
    readonly variables: ReadonlyArray<SlotVariable>;
    readonly sequencePoints: ReadonlyArray<SequencePoint>;
}

export interface DebugInfo {
    readonly hash: Uint8Array,
    readonly methods: ReadonlyArray<DebugInfoMethod>
    toJson(): DebugInfoJson
}

function asSlotVarString(v: SlotVariable): string {
    const type = asContractParamType(v.type);
    return `${v.name},${sc.ContractParamType[type]},${v.index}`
}

const asSeqPointString =
    (docs: ReadonlyArray<tsm.SourceFile>) =>
        (sp: SequencePoint): string => {
            const index = docs.indexOf(asSourceFile(sp));
            if (index < 0) throw new Error("asSeqPointString");
            const src = docs[index];
            const [start, end] = tsm.Node.isNode(sp.location)
                ? [src.getLineAndColumnAtPos(sp.location.getStart()), src.getLineAndColumnAtPos(sp.location.getEnd())]
                : [src.getLineAndColumnAtPos(sp.location.start.getStart()), src.getLineAndColumnAtPos(sp.location.end.getEnd())]
            return `${sp.address}[${index}]${start.line}:${start.column}-${end.line}:${end.column}`
        }

const toDebugMethodJson =
    (docs: ReadonlyArray<tsm.SourceFile>) =>
        (method: DebugInfoMethod): DebugMethodJson => {
            return {
                id: method.name,
                name: ',' + method.name,
                range: `${method.range.start}-${method.range.end}`,
                params: method.parameters.map(asSlotVarString),
                variables: method.variables.map(asSlotVarString),
                return: sc.ContractParamType[asReturnType(method.returnType)],
                "sequence-points": method.sequencePoints.map(asSeqPointString(docs)),
            }
        }

function asSourceFile(sp: SequencePoint) {
    return tsm.Node.isNode(sp.location)
        ? sp.location.getSourceFile()
        : sp.location.start.getSourceFile()
}

function toDebugInfoJson(hash: Buffer, methods: ReadonlyArray<DebugInfoMethod>): DebugInfoJson {

    const sourceOrd: FP.ord.Ord<tsm.SourceFile> = {
        equals: (x, y) => FP.string.Ord.equals(x.getFilePath(), y.getFilePath()),
        compare: (x, y) => FP.string.Ord.compare(x.getFilePath(), y.getFilePath())
    };

    const docs = pipe(methods,
        ROA.map(m => m.sequencePoints),
        ROA.flatten,
        ROA.map(asSourceFile),
        ROS.fromReadonlyArray(sourceOrd),
        ROS.toReadonlyArray(sourceOrd)
    );

    return {
        hash: `0x${hash.toString('hex')}`,
        // TODO: correct processing of file path
        // currently stripping off initial slash 
        documents: docs.map(v => v.getFilePath().substring(1)),
        methods: methods.map(toDebugMethodJson(docs)),
        events: [],
        "static-variables": [],
    }
}
export function makeDebugInfo(nef: sc.NEF, methods: ReadonlyArray<DebugInfoMethod>): DebugInfo {
    const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();
    return {
        hash,
        methods,
        toJson: () => toDebugInfoJson(hash, methods),
    }
}

interface DebugEventJson {
    id: string;
    name: string;
    params?: string[];
}

interface DebugMethodJson {
    id: string;
    name: string;
    range: string; // format: "{start-address}-{end-address}
    params?: string[];
    "return"?: string;
    variables?: string[];
    "sequence-points"?: string[]; // format: "{address}[{document-index}]{start-line}:{start-column}-{end-line}:{end-column}"
}

interface DebugInfoJson {
    hash: string; // hex-encoded UInt160
    documents?: string[]; // file paths
    "document-root"?: string;
    events?: ReadonlyArray<DebugEventJson>;
    methods?: ReadonlyArray<DebugMethodJson>;
    "static-variables"?: string[];

}

// export interface DebugInfo {
//     methods?: DebugMethod[];
//     // events?: Event[];
// }

// export interface DebugMethod {
//     id: string,
//     name: string;
//     range: { start: number, end: number };
//     parameters?: SlotVariable[];
//     variables?: SlotVariable[];
//     returnType?: sc.ContractParamType;
//     sequencePoints?: SequencePointLocation[];
// }

// // export interface Event {
// //     name: string;
// //     parameters?: SlotVariable[];
// // }

// export interface SlotVariable {
//     name: string;
//     type: sc.ContractParamType;
//     index?: number;
// }

// // export interface Struct {
// //     name: string,
// //     fields: {
// //         name: string,
// //         type: ContractType
// //     }[]
// // }

// // export interface StorageGroupDef {
// //     name: string;
// //     type: ContractType;
// //     keyPrefix: Uint8Array;
// //     keySegments: {
// //         name: string;
// //         type: PrimitiveType;
// //     }[];
// // }

// export interface SequencePointLocation {
//     address: number;
//     location: Location,
// }

// export interface DebugEventJson {
//     id: string;
//     name: string;
//     params?: string[];
// }
// export interface DebugMethodJson {
//     id: string;
//     name: string;
//     range: string; // format: "{start-address}-{end-address}
//     params?: string[];
//     "return"?: string;
//     variables?: string[];
//     "sequence-points"?: string[]; // format: "{address}[{document-index}]{start-line}:{start-column}-{end-line}:{end-column}"
// }

// export interface DebugInfoJson {
//     hash: string; // hex-encoded UInt160
//     documents?: string[]; // file paths
//     "document-root"?: string;
//     events?: ReadonlyArray<DebugEventJson>;
//     methods?: ReadonlyArray<DebugMethodJson>;
//     "static-variables"?: string[];
// }

// // export function toJson(methods: DebugMethod[], nef: sc.NEF) {
// //     const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();
// //     const sourceFiles = [...new Set(methods
// //         .flatMap(m => m.sequencePoints ?? [])
// //         .map(sp => sp.location.getSourceFile()))];
// // }

// // export function toJson(info: DebugInfo, nef: sc.NEF, sourceDir?: string): DebugInfoJson {
// //     const documentSet = [...new Set(info.methods
// //         ?.flatMap(m => m.sequencePoints ?? [])
// //         .map(sp => sp.location.getSourceFile()) ?? [])
// //         .values()];

// //     const documentMap = new Map(documentSet.map((v, i) => [v, i]));
// //     const documents = documentSet
// //         .map(d => {
// //             const path = d.getFilePath();
// //             return sourceDir
// //                 ? join(sourceDir, path)
// //                 : path
// //         });

// //     const methods = info.methods?.map(m => {
// //         return {
// //             name: `,${m.name}`,
// //             range: `${m.range.start}-${m.range.end}`,
// //             params: m.parameters?.map((p, i) => `${p.name},${contractTypeToString(p.type)},${i}`),
// //             "return": m.returnType ? contractTypeToString(m.returnType) : undefined,
// //             variables: m.variables?.map(v => `${v.name},${contractTypeToString(v.type)},${v.index!}`),
// //             "sequence-points": m.sequencePoints?.map(sp => {
// //                 const { address, location: node } = sp;
// //                 const src = node.getSourceFile();
// //                 const start = src.getLineAndColumnAtPos(node.getStart());
// //                 const end = src.getLineAndColumnAtPos(node.getEnd());
// //                 const index = documentMap.get(src)!;
// //                 return `${address}[${index}]${start.line}:${start.column}-${end.line}:${end.column}`
// //             })
// //         }
// //     })

// //     const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();
// //     const json: DebugInfoJson = {
// //         version: 2,
// //         hash: `0x${hash.toString('hex')}`,
// //         checksum: nef.checksum,
// //         documents,
// //         methods
// //     }
// //     return json;
// // }
