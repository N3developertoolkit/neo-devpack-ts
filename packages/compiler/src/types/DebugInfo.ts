import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";

import { pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import { Location, getOperationSize } from "./Operation";
import { asContractParamType, asReturnType } from "../utils";
import { CompiledProject, ContractEvent, ContractMethod, ContractVariable, DebugInfo, DebugInfoEvent, DebugInfoMethod, SequencePoint } from "./CompileOptions";


function asSlotVarString(v: ContractVariable): string {
    const type = asContractParamType(v.type);
    return `${v.name},${sc.ContractParamType[type]},${v.index}`
}

function asSeqPointString(docs: readonly tsm.SourceFile[]) {
    return (sp: SequencePoint): string => {
        const index = docs.indexOf(asSourceFile(sp));
        if (index < 0)
            throw new Error("asSeqPointString");
        const src = docs[index];
        const [start, end] = tsm.Node.isNode(sp.location)
            ? [src.getLineAndColumnAtPos(sp.location.getStart()), src.getLineAndColumnAtPos(sp.location.getEnd())]
            : [src.getLineAndColumnAtPos(sp.location.start.getStart()), src.getLineAndColumnAtPos(sp.location.end.getEnd())];
        return `${sp.address}[${index}]${start.line}:${start.column}-${end.line}:${end.column}`;
    };
}

function asSourceFile(sp: SequencePoint) {
    return tsm.Node.isNode(sp.location)
        ? sp.location.getSourceFile()
        : sp.location.start.getSourceFile()
}

function asContractVariable(index: number, node: tsm.ParameterDeclaration): ContractVariable {
    return { name: node.getName(), type: node.getType(), index }
}

function getParameters(node: tsm.FunctionDeclaration) {
    return pipe(node.getParameters(), ROA.mapWithIndex(asContractVariable), ROA.map(asSlotVarString));
}

function makeDebugInfoMethod(docs: readonly tsm.SourceFile[]) {
    return ({ method, range, sequencePoints }: MethodDebugInfo): DebugInfoMethod => {
        const name = method.symbol.getName();
        return {
            id: name,
            name: `,${name}`,
            range: `${range.start}-${range.end}`,
            params: getParameters(method.node),
            variables: pipe(method.variables, ROA.map(asSlotVarString)),
            return: sc.ContractParamType[asReturnType(method.node.getReturnType())],
            "sequence-points": pipe(sequencePoints, ROA.map(asSeqPointString(docs)))
        }
    }
}

function makeDebugInfoEvent(event: ContractEvent): DebugInfoEvent {
    return {
        id: event.symbol.getName(),
        name: `,` + event.symbol.getName(),
        params: getParameters(event.node)
    }
}

interface MethodDebugInfo {
    readonly method: ContractMethod,
    readonly range: { readonly start: number, readonly end: number },
    readonly sequencePoints: readonly SequencePoint[];
}

function collectMethodDebugInfo(methods: readonly ContractMethod[]): readonly MethodDebugInfo[] {
    let address = 0;
    const infoArray = new Array<MethodDebugInfo>();
    for (const method of methods) {
        const start = address;
        let end = address;
        const sequencePoints = new Array<SequencePoint>();
        for (const op of method.operations) {
            end = address;
            if (op.location) {
                sequencePoints.push({ address, location: op.location })
            }
            address += getOperationSize(op);
        }
        infoArray.push({ method, range: { start, end }, sequencePoints })
    }
    return infoArray;
}

export function makeDebugInfo(project: CompiledProject, nef: sc.NEF): DebugInfo {

    const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();
    const methodInfos = collectMethodDebugInfo(project.methods);
    const docs = pipe(
        methodInfos,
        ROA.map(v => v.sequencePoints),
        ROA.flatten,
        ROA.map(asSourceFile),
        ROA.uniq({ equals: (x, y) => x.getFilePath() === y.getFilePath() })
    );

    return {
        hash: `0x${hash.toString('hex')}`,
        documents: pipe(docs, ROA.map(v => v.getFilePath().substring(1))),
        methods: pipe(methodInfos, ROA.map(makeDebugInfoMethod(docs))),
        events: pipe(project.events, ROA.map(makeDebugInfoEvent)),
        "static-variables": pipe(project.staticVars, ROA.map(asSlotVarString)),
    }
}
