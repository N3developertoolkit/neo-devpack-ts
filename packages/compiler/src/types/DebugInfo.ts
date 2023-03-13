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
            const params = method.parameters.length > 0
                ? method.parameters.map(asSlotVarString)
                : undefined;
            const variables = method.variables.length > 0 
                ? method.variables.map(asSlotVarString)
                : undefined
            const sequencePoints = method.sequencePoints.length > 0
                ? method.sequencePoints.map(asSeqPointString(docs))
                : undefined
            return {
                id: method.name,
                name: ',' + method.name,
                range: `${method.range.start}-${method.range.end}`,
                params,
                variables,
                return: sc.ContractParamType[asReturnType(method.returnType)],
                "sequence-points": sequencePoints
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
        documents: docs.map(v => v.getFilePath().substring(1)),
        methods: methods
            .map(toDebugMethodJson(docs))
            .filter(j => j["sequence-points"] !== undefined && j["sequence-points"].length !== 0),
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
    // format: "{start-address}-{end-address}
    range: string; 
    params?: string[];
    "return"?: string;
    variables?: string[];
    // format: "{address}[{document-index}]{start-line}:{start-column}-{end-line}:{end-column}"
    "sequence-points"?: string[]; 
}

interface DebugInfoJson {
    hash: string; // hex-encoded UInt160
    documents?: string[]; // file paths
    "document-root"?: string;
    events?: ReadonlyArray<DebugEventJson>;
    methods?: ReadonlyArray<DebugMethodJson>;
    "static-variables"?: string[];
}