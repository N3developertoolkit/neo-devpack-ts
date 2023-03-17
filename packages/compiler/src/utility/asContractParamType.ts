import { sc } from "@cityofzion/neon-core";
import { Type } from "ts-morph";
import { isBigIntLike, isBooleanLike, isNumberLike, isStringLike, isVoidLike } from "../utils";

export function asContractParamType(type: Type): sc.ContractParamType {

    if (type.isAny())
        return sc.ContractParamType.Any;
    if (isStringLike(type))
        return sc.ContractParamType.String;
    if (isBigIntLike(type) || isNumberLike(type))
        return sc.ContractParamType.Integer;
    if (isBooleanLike(type))
        return sc.ContractParamType.Boolean;

    const typeSymbol = type.getAliasSymbol() ?? type.getSymbolOrThrow();
    const typeFQN = typeSymbol.getFullyQualifiedName();
    if (typeFQN === "global.ByteStringInstance") {
        return sc.ContractParamType.ByteArray;
    }

    if (typeFQN === "Iterator") {
        return sc.ContractParamType.InteropInterface;
    }

    return sc.ContractParamType.Any;
}

export function asReturnType(type: Type) {
    return isVoidLike(type)
        ? sc.ContractParamType.Void
        : asContractParamType(type);
}
