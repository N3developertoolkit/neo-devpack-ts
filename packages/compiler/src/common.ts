
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
    kind: ContractTypeKind.Unspecified,
}

export interface PrimitiveContractType extends ContractType {
    kind: ContractTypeKind.Primitive,
    readonly type: PrimitiveType
}

export function isPrimitive(type: ContractType): type is PrimitiveContractType {
    return type.kind === ContractTypeKind.Primitive;
}

export interface StructContractType extends ContractType {
    kind: ContractTypeKind.Struct,
    readonly name: string,
    readonly fields: ReadonlyArray<{
        readonly name: string, 
        readonly type: ContractType}>,
}

export interface ArrayContractType extends ContractType {
    kind: ContractTypeKind.Array,
    readonly type: ContractType,
}

export interface MapContractType extends ContractType {
    kind: ContractTypeKind.Map,
    readonly keyType: PrimitiveType,
    readonly valueType: ContractType,
}

export interface InteropContractType extends ContractType {
    kind: ContractTypeKind.Interop,
    readonly type: string
}
