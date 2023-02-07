import { sc } from "@cityofzion/neon-core";
import { ContractParameterDefinition } from "@cityofzion/neon-core/lib/sc";
import { CompileContext } from "./compiler";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import * as tsm from "ts-morph";
import { isBigIntLike, isBooleanLike, isNumberLike, isStringLike, isVoidLike } from "./utils";
import { DebugInfo, DebugMethod, SequencePoint, SlotVariable } from "./types/DebugInfo";
import { getOperationSize } from "./processContractMethods";
import { Operation } from "./types/Operation";
import { first, last } from "ix/iterable";

export function convertToContractParamType(type: tsm.Type): sc.ContractParamType {

    if (isStringLike(type)) return sc.ContractParamType.String;
    if (isBigIntLike(type) || isNumberLike(type)) return sc.ContractParamType.Integer;
    if (isBooleanLike(type)) return sc.ContractParamType.Boolean;

    const typeSymbol = type.getAliasSymbol() ?? type.getSymbolOrThrow();
    const typeFQN = typeSymbol.getFullyQualifiedName();
    if (typeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteString'
        || typeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".StorageValue') {
        return sc.ContractParamType.ByteArray
    }

    throw new Error(`convertTypeScriptType ${type.getText()} not implemented`);
}

export function toContractMethodDefinition(method: ContractMethod, ops: AddressedOperation[]) {
    if (!method.public) return undefined;
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
        offset: first(ops)!.address,
        returnType,
        parameters
    })
}

export function toDebugMethod(method: ContractMethod, ops: AddressedOperation[]): DebugMethod {
    const name = "," + method.name;
    const id = name;
    const start = first(ops)!.address;
    const end = last(ops)!.address;
    const returnType = isVoidLike(method.returnType)
        ? sc.ContractParamType.Void
        : convertToContractParamType(method.returnType);
    const parameters: SlotVariable[] = method.parameters
        .map((v, index) => ({
            name: v.name, type: convertToContractParamType(v.type), index
        } as SlotVariable));
    const variables = method.variables
        .map((v, index) => ({
            name: v.name, type: convertToContractParamType(v.type), index
        } as SlotVariable))
    const sequencePoints = ops
        .filter(v => !!v.operation.location)
        .map(v => ({
            address: v.address,
            location: v.operation.location!
        } as SequencePoint));

    return {
        id,
        name,
        range: { start, end },
        parameters,
        returnType,
        variables,
        sequencePoints
    };
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

export function collectArtifacts(context: CompileContext) {
    let offset = 0;
    const methodDefs = new Array<sc.ContractMethodDefinition>();
    const debugMethods = new Array<DebugMethod>();
    let script = Buffer.from([]);

    for (const method of context.methods) {
        if (!method.instructions) throw new Error();

        const ops = [...getAddressedOperation(method, offset)];
        offset += method.instructions.length;
        script = Buffer.concat([script, method.instructions]);

        const methodDef = toContractMethodDefinition(method, ops);
        if (methodDef) methodDefs.push(methodDef);
        debugMethods.push(toDebugMethod(method, ops));
    }

    const manifest = new sc.ContractManifest({
        name: 'test-contract',
        abi: new sc.ContractAbi({ methods: methodDefs })
    });

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(script).toString("hex"),
    });

    const debugInfo = {
        methods: debugMethods
    } as DebugInfo;

    return { nef, manifest, debugInfo };

}
