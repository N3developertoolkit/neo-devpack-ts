import { sc, u } from "@cityofzion/neon-core";
import { ContractParameterDefinition } from "@cityofzion/neon-core/lib/sc";
import { CompileContext } from "./compiler";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import * as tsm from "ts-morph";
import { isBigIntLike, isBooleanLike, isNumberLike, isStringLike, isVoidLike } from "./utils";
import { DebugInfoJson, DebugMethodJson, SequencePointLocation } from "./types/DebugInfo";
import { compileMethodScript, getMethodSize } from "./processContractMethods";
import { CallTokenOperation, Location, Operation } from "./types/Operation";
import { from } from "ix/iterable";
import { map, flatMap, filter } from "ix/iterable/operators";
import { MethodSymbolDef } from "./scope";

export function convertToContractParamType(type: tsm.Type): sc.ContractParamType {

    if (type.isAny()) return sc.ContractParamType.Any;
    if (isStringLike(type)) return sc.ContractParamType.String;
    if (isBigIntLike(type) || isNumberLike(type)) return sc.ContractParamType.Integer;
    if (isBooleanLike(type)) return sc.ContractParamType.Boolean;

    const typeSymbol = type.getAliasSymbol() ?? type.getSymbolOrThrow();
    const typeFQN = typeSymbol.getFullyQualifiedName();
    if (typeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteString'
        || typeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".StorageValue') {
        return sc.ContractParamType.ByteArray
    }

    return sc.ContractParamType.Any;
}

function getReturnContractParamType(node: tsm.FunctionDeclaration) {
    const returnType = node.getReturnType();
    return isVoidLike(returnType)
        ? sc.ContractParamType.Void
        : convertToContractParamType(returnType);
}

function hasSafeTag(node: tsm.JSDocableNode): boolean {
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            const tagName = tag.getTagName();
            if (tagName === "safe") {
                return true;
            }
        }
    }
    return false;
}

export function toContractMethodDefinition(method: ContractMethod, offset: number): sc.ContractMethodDefinition | undefined {

    const node = method.def.node;
    if (!node.getExportKeyword()) return undefined;
    const parameters = node.getParameters()
        .map(p => ({ 
            name: p.getName(), 
            type: convertToContractParamType(p.getType()) }));

    return new sc.ContractMethodDefinition({
        name: method.def.symbol.getName(),
        safe: hasSafeTag(node),
        offset,
        returnType: getReturnContractParamType(node),
        parameters
    })
}

function toSlotVariableString(name: string, type: tsm.Type, index: number) {
    const $type = convertToContractParamType(type);
    return `${name},${sc.ContractParamType[$type]},${index}`
}

function getSourceFile(location: Location) {
    return tsm.Node.isNode(location)
        ? location.getSourceFile()
        : location.start.getSourceFile();
}
function toSequencePointString(point: SequencePointLocation, documentMap: ReadonlyMap<tsm.SourceFile, number>): string {
    const location = point.location;
    const src = getSourceFile(location);

    const index = documentMap.get(src);
    if (index === undefined) throw new Error("toSequencePointString");
    const [start, end] = tsm.Node.isNode(location)
        ? [src.getLineAndColumnAtPos(location.getStart()), src.getLineAndColumnAtPos(location.getEnd())]
        : [src.getLineAndColumnAtPos(location.start.getStart()), src.getLineAndColumnAtPos(location.end.getEnd())]
    return `${point.address}[${index}]${start.line}:${start.column}-${end.line}:${end.column}`
}

export function toDebugMethodJson(
    method: ContractMethod,
    range: { start: number, end: number },
    sequencePoints: ReadonlyArray<SequencePointLocation>,
    documentMap: ReadonlyMap<tsm.SourceFile, number>
): DebugMethodJson {

    const node = method.def.node;
    const name = "," + node.getSymbolOrThrow().getName();
    const params = node.getParameters()
        .map((v, index) => toSlotVariableString(v.getName(), v.getType(), index));
    const variables = method.variables
        .map((v, index) => toSlotVariableString(v.name, v.type, index));
    const points = sequencePoints
        .map(v => toSequencePointString(v, documentMap))

    return {
        id: name,
        name,
        range: `${range.start}-${range.end}`,
        return: sc.ContractParamType[getReturnContractParamType(node)],
        params,
        variables,
        "sequence-points": points
    } as DebugMethodJson;
}

interface MethodInfo {
    range: { start: number, end: number },
    sequencePoints: ReadonlyArray<SequencePointLocation>
}

export function isCallTokenOperation(ins: Operation): ins is CallTokenOperation {
    return ins.kind === 'calltoken';
}

function collectMethodTokens(methods: ReadonlyArray<ContractMethod>): ReadonlyArray<sc.MethodToken> {
    const callTokenOps = from(methods).pipe(
        flatMap(m => m.operations),
        filter(isCallTokenOperation));
    const map = new Map<string, sc.MethodToken>();
    for (const { token } of callTokenOps) {
        const key = `${token.hash}-${token.method}`;
        const value = map.get(key);
        if (value) {
            // todo: ensure remaining token fields match
        } else {
            map.set(key, token);
        }
    }
    return [...map.values()]
}

function collectMethodAddressMap(methods: ContractMethod[]): ReadonlyMap<MethodSymbolDef, number> {
    let address = 0;
    const methodAddressMap = new Map<MethodSymbolDef, number>();
    for (const m of methods) {
        methodAddressMap.set(m.def, address);
        address += getMethodSize(m);
    }
    return methodAddressMap;
}

export function collectArtifacts(contractName: string, { methods, diagnostics, options: { standards } }: CompileContext) {

    const tokens = collectMethodTokens(methods);
    const methodAddressMap = collectMethodAddressMap(methods);
    const compileMethodOptions = { diagnostics, tokens, methodAddressMap };

    let script = Buffer.from([]);
    const methodMap = new Map<ContractMethod, MethodInfo>();

    for (const method of methods) {
        const { instructions, range, sequencePoints } = compileMethodScript(method, script.length, compileMethodOptions);
        script = Buffer.concat([script, instructions]);
        methodMap.set(method, { range, sequencePoints });
    }

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(script).toString("hex"),
        tokens: tokens.map(t => t.export()),
    });
    const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();

    const sourceFiles = new Set(from(methodMap.values()).pipe(
        flatMap(v => v.sequencePoints),
        map(v => getSourceFile(v.location))));
    const docsMap = new Map(from(sourceFiles).pipe(map((v, i) => [v, i])));

    const manifestMethods = new Array<sc.ContractMethodDefinition>();
    const debugMethods = new Array<DebugMethodJson>();
    for (const [method, info] of methodMap.entries()) {
        const debugMethod = toDebugMethodJson(method, info.range, info.sequencePoints, docsMap)
        debugMethods.push(debugMethod);
        const manifestMethod = toContractMethodDefinition(method, info.range.start);
        if (manifestMethod) manifestMethods.push(manifestMethod);
    }
    
    const manifest = new sc.ContractManifest({
        name: contractName,
        supportedStandards: [...standards],
        abi: new sc.ContractAbi({ methods: manifestMethods})
    });

    const debugInfo: DebugInfoJson = {
        hash: `0x${hash.toString('hex')}`,
        // TODO: correct processing of file path
        // currently stripping off initial slash 
        documents: [...from(sourceFiles).pipe(map(v => v.getFilePath().substring(1)))],
        methods: debugMethods,
        "static-variables": [],
        events: []
    }

    return { nef, manifest, debugInfo };
}


