
// Typescript implementation of ContractType from Debug Info v2 (https://github.com/neo-project/proposals/pull/151)
// Port of C# ContractType implementation from https://github.com/ngdenterprise/neo-blockchaintoolkit-library/blob/develop/src/bctklib/models/ContractTypes.cs

import { isStringLike, isBigIntLike, isNumberLike, isBooleanLike } from "./utils";
import * as tsm from "ts-morph";

export enum ContractTypeKind {
    Unspecified,
    Primitive,
    Struct,
    Array,
    Map,
    Interop
}

export interface ContractType {
    readonly kind: ContractTypeKind
}

export interface UnspecifiedContractType extends ContractType {
    readonly kind: ContractTypeKind.Unspecified,
}

export function isUnspecifiedType(type: ContractType): type is UnspecifiedContractType {
    return type.kind === ContractTypeKind.Unspecified;
}

export enum PrimitiveType {
    Boolean,
    Integer,
    ByteArray,
    String,
    Hash160,
    Hash256,
    PublicKey,
    Signature,
    Address,
}

export interface PrimitiveContractType extends ContractType {
    readonly kind: ContractTypeKind.Primitive,
    readonly type: PrimitiveType
}

export function isPrimitiveType(type: ContractType): type is PrimitiveContractType {
    return type.kind === ContractTypeKind.Primitive;
}

export interface StructContractType extends ContractType {
    kind: ContractTypeKind.Struct,
    readonly name: string,
    readonly fields: ReadonlyArray<{
        readonly name: string, 
        readonly type: ContractType}>,
}

export function isStructType(type: ContractType): type is StructContractType {
    return type.kind === ContractTypeKind.Struct;
}

export interface ArrayContractType extends ContractType {
    kind: ContractTypeKind.Array,
    readonly type: ContractType,
}

export function isArrayType(type: ContractType): type is ArrayContractType {
    return type.kind === ContractTypeKind.Array;
}

export interface MapContractType extends ContractType {
    kind: ContractTypeKind.Map,
    readonly keyType: PrimitiveType,
    readonly valueType: ContractType,
}

export function isMapType(type: ContractType): type is MapContractType {
    return type.kind === ContractTypeKind.Map;
}

export interface InteropContractType extends ContractType {
    kind: ContractTypeKind.Interop,
    readonly type: string
}

export function isInteropType(type: ContractType): type is InteropContractType {
    return type.kind === ContractTypeKind.Interop;
}

export function tsTypeToContractType(type: tsm.Type): ContractType {

    if (isStringLike(type)) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.String,
    } as PrimitiveContractType;

    if (isBigIntLike(type) || isNumberLike(type)) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.Integer
    } as PrimitiveContractType;

    if (isBooleanLike(type)) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.Boolean
    } as PrimitiveContractType;

    throw new Error(`convertTypeScriptType ${type.getText()} not implemented`);
}
