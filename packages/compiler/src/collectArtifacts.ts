import { sc, u } from "@cityofzion/neon-core";
import { ContractParameterDefinition } from "@cityofzion/neon-core/lib/sc";
import { CompileContext } from "./compiler";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import * as tsm from "ts-morph";
import { isBigIntLike, isBooleanLike, isNumberLike, isStringLike, isVoidLike } from "./utils";
import { DebugInfoJson, DebugMethodJson, SequencePointLocation } from "./types/DebugInfo";
import { compileMethodScript, getOperationSize } from "./processContractMethods";
import { isCallTokenOperation, Location, Operation } from "./types/Operation";
import { from } from "ix/iterable";
import { map, flatMap } from "ix/iterable/operators";

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

export function toContractMethodDefinition(method: ContractMethod, offset: number) {
    const returnType = isVoidLike(method.returnType)
        ? sc.ContractParamType.Void
        : convertToContractParamType(method.returnType);
    const parameters = method.parameters.map(p => ({
        name: p.name,
        type: convertToContractParamType(p.type)
    } as ContractParameterDefinition));
    return new sc.ContractMethodDefinition({
        name: method.name,
        safe: method.safe,
        offset,
        returnType,
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
    range: {start: number, end: number}, 
    sequencePoints: ReadonlyArray<SequencePointLocation>,
    documentMap: ReadonlyMap<tsm.SourceFile, number>
    ): DebugMethodJson {

    const returnType = isVoidLike(method.returnType)
        ? sc.ContractParamType.Void
        : convertToContractParamType(method.returnType);
    const params = method.parameters
        .map((v, index) => toSlotVariableString(v.name, v.type, index));
    const variables = method.variables
        .map((v, index) => toSlotVariableString(v.name, v.type, index));
    const points = sequencePoints
        .map(v => toSequencePointString(v, documentMap))


    return {
        id: "," + method.name,
        name: "," + method.name,
        range: `${range.start}-${range.end}`,
        return: sc.ContractParamType[returnType],
        params,
        variables,
        "sequence-points": points
    } as DebugMethodJson;
}

interface AddressedOperation {
    address: number;
    size: number;
    operation: Operation;
}
function* getAddressedOperation(method: ContractMethod, offset: number): Generator<AddressedOperation, void> {
    let address = offset;
    for (const operation of method.operations) {
        const size = getOperationSize(operation);
        yield { address, size, operation }
        address += size;
    }
}

interface MethodInfo {
    range: { start: number, end: number },
    sequencePoints: ReadonlyArray<SequencePointLocation>
}

function collectMethodTokens(methods: ReadonlyArray<ContractMethod>) {
    const ops = methods.flatMap(m => m.operations).filter(isCallTokenOperation);

    const map = new Map<string, sc.MethodToken>();
    for (const { token }of ops) {
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

export function collectArtifacts(contractName: string, { methods, diagnostics}: CompileContext) {

    const tokens = collectMethodTokens(methods);

    let script = Buffer.from([]);
    const methodMap = new Map<ContractMethod, MethodInfo>();

    for (const method of methods) {
        const { instructions, range, sequencePoints } = compileMethodScript(method, script.length, tokens, diagnostics);
        script = Buffer.concat([script, instructions]);
        methodMap.set(method, { range, sequencePoints });
    }

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(script).toString("hex"),
        tokens: tokens.map(t => t.export()),
    });
    const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();

    const manifestMethods = [...from(methodMap.entries()).pipe(
        map(x => toContractMethodDefinition(x[0], x[1].range.start))
    )];

    const manifest = new sc.ContractManifest({
        name: contractName,
        abi: new sc.ContractAbi({ methods: manifestMethods })
    });

    const sourceFiles = new Set(from(methodMap.values()).pipe(
        flatMap(v => v.sequencePoints),
        map(v => getSourceFile(v.location))));
    const docsMap = new Map(from(sourceFiles).pipe(map((v, i) => [v, i])));
    const debugMethods = [...from(methodMap.entries()).pipe(
        map(x => toDebugMethodJson(x[0], x[1].range, x[1].sequencePoints, docsMap))
    )];
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
