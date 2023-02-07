import { sc } from "@cityofzion/neon-core";
import { ContractParameterDefinition } from "@cityofzion/neon-core/lib/sc";
import { CompileContext } from "./compiler";
import { ContractMethod } from "./passes/processFunctionDeclarations";
import * as tsm from "ts-morph";
import { isBigIntLike, isBooleanLike, isNumberLike, isStringLike, isVoidLike } from "./utils";

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

export function toContractMethodDefinition(method: ContractMethod, offset: number) {
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
        offset,
        returnType,
        parameters
    })
}

export function collectArtifacts(context: CompileContext) {
    let offset = 0;
    const methodDefs = new Array<sc.ContractMethodDefinition>();
    let script = Buffer.from([]);

    for (const method of context.methods) {
        if (!method.instructions)
            throw new Error();
        const methodDef = toContractMethodDefinition(method, offset);
        if (methodDef)
            methodDefs.push(methodDef);
        offset += method.instructions.length;
        script = Buffer.concat([script, method.instructions]);
    }

    const manifest = new sc.ContractManifest({
        name: 'test-contract',
        abi: new sc.ContractAbi({ methods: methodDefs })
    });

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(script).toString("hex"),
    });

    return { nef, manifest };

}
