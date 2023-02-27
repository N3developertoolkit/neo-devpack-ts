import { sc, u } from "@cityofzion/neon-core";
import { CompileOptions, CompilerState, ContractMethod } from "./compiler";
import { DebugInfoJson } from "./types/DebugInfo";
import { pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as ROS from 'fp-ts/ReadonlySet'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as E from 'fp-ts/Either'
import * as FP from 'fp-ts'
import { CallOperation, CallTokenOperation, convertJumpOperationKind, convertLoadStoreKind, convertSimpleOperationKind, getOperationSize, isCallOp, isCallTokenOp, isConvertOp, isInitSlotOp, isJumpOffsetOp, isJumpTargetOp, isLoadStoreOp, isPushBoolOp, isPushDataOp, isPushIntOp, isSimpleOp, isSysCallOp, JumpOffsetOperation, LoadStoreOperation, Operation, PushDataOperation, PushIntOperation, SysCallOperation } from "./types/Operation";
import { FunctionDeclaration, JSDocableNode, Symbol, Type } from "ts-morph";
import { convertBigInteger, isBigIntLike, isBooleanLike, isNumberLike, isStringLike, isVoidLike } from "./utils";
import { stripVTControlCharacters } from "util";

// export function convertToContractParamType(type: tsm.Type): sc.ContractParamType {

//     if (type.isAny()) return sc.ContractParamType.Any;
//     if (isStringLike(type)) return sc.ContractParamType.String;
//     if (isBigIntLike(type) || isNumberLike(type)) return sc.ContractParamType.Integer;
//     if (isBooleanLike(type)) return sc.ContractParamType.Boolean;

//     const typeSymbol = type.getAliasSymbol() ?? type.getSymbolOrThrow();
//     const typeFQN = typeSymbol.getFullyQualifiedName();
//     if (typeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteString'
//         || typeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".StorageValue') {
//         return sc.ContractParamType.ByteArray
//     }

//     return sc.ContractParamType.Any;
// }

// function getReturnContractParamType(node: tsm.FunctionDeclaration) {
//     const returnType = node.getReturnType();
//     return isVoidLike(returnType)
//         ? sc.ContractParamType.Void
//         : convertToContractParamType(returnType);
// }

// function hasSafeTag(node: tsm.JSDocableNode): boolean {
//     for (const doc of node.getJsDocs()) {
//         for (const tag of doc.getTags()) {
//             const tagName = tag.getTagName();
//             if (tagName === "safe") {
//                 return true;
//             }
//         }
//     }
//     return false;
// }

// export function toContractMethodDefinition(method: ContractMethod, offset: number): sc.ContractMethodDefinition | undefined {

//     const node = method.def.node;
//     if (!node.getExportKeyword()) return undefined;
//     const parameters = node.getParameters()
//         .map(p => ({ 
//             name: p.getName(), 
//             type: convertToContractParamType(p.getType()) }));

//     return new sc.ContractMethodDefinition({
//         name: method.def.symbol.getName(),
//         safe: hasSafeTag(node),
//         offset,
//         returnType: getReturnContractParamType(node),
//         parameters
//     })
// }

// function toSlotVariableString(name: string, type: tsm.Type, index: number) {
//     const $type = convertToContractParamType(type);
//     return `${name},${sc.ContractParamType[$type]},${index}`
// }

// function getSourceFile(location: Location) {
//     return tsm.Node.isNode(location)
//         ? location.getSourceFile()
//         : location.start.getSourceFile();
// }
// function toSequencePointString(point: SequencePointLocation, documentMap: ReadonlyMap<tsm.SourceFile, number>): string {
//     const location = point.location;
//     const src = getSourceFile(location);

//     const index = documentMap.get(src);
//     if (index === undefined) throw new Error("toSequencePointString");
//     const [start, end] = tsm.Node.isNode(location)
//         ? [src.getLineAndColumnAtPos(location.getStart()), src.getLineAndColumnAtPos(location.getEnd())]
//         : [src.getLineAndColumnAtPos(location.start.getStart()), src.getLineAndColumnAtPos(location.end.getEnd())]
//     return `${point.address}[${index}]${start.line}:${start.column}-${end.line}:${end.column}`
// }

// export function toDebugMethodJson(
//     method: ContractMethod,
//     range: { start: number, end: number },
//     sequencePoints: ReadonlyArray<SequencePointLocation>,
//     documentMap: ReadonlyMap<tsm.SourceFile, number>
// ): DebugMethodJson {

//     const node = method.def.node;
//     const name = "," + node.getSymbolOrThrow().getName();
//     const params = node.getParameters()
//         .map((v, index) => toSlotVariableString(v.getName(), v.getType(), index));
//     const variables = method.variables
//         .map((v, index) => toSlotVariableString(v.name, v.type, index));
//     const points = sequencePoints
//         .map(v => toSequencePointString(v, documentMap))

//     return {
//         id: name,
//         name,
//         range: `${range.start}-${range.end}`,
//         return: sc.ContractParamType[getReturnContractParamType(node)],
//         params,
//         variables,
//         "sequence-points": points
//     } as DebugMethodJson;
// }

// interface MethodInfo {
//     range: { start: number, end: number },
//     sequencePoints: ReadonlyArray<SequencePointLocation>
// }

function collectMethodTokens(methods: ReadonlyArray<ContractMethod>): ReadonlyArray<sc.MethodToken> {

    const eq: FP.eq.Eq<sc.MethodToken> = {
        equals: (x, y) => x.hash === y.hash && x.method === y.method
    };

    const set = pipe(
        methods, 
        ROA.map(m => m.operations),
        ROA.flatten,
        ROA.filter(isCallTokenOp),
        ROA.map(m => m.token),
        ROS.fromReadonlyArray(eq),
    )
    return [...set.values()];
}

function *calcOperationAddresses(methods: ReadonlyArray<ContractMethod>): Generator<{ address: number; op: Operation; }, void, unknown> {
    let address = 0;
    for (const method of methods) {
        for (const op of method.operations) {
            yield { address, op };
            address += getOperationSize(op);
        }
    }

}

function *calcMethodAddresses(methods: ReadonlyArray<ContractMethod>): Generator<[Symbol,  number], void, unknown> {
    let address = 0;
    for (const method of methods) {
        yield [method.symbol, address];
        for (const op of method.operations) {
            address += getOperationSize(op);
        }
    }
}

// neon-js hasn't added the PUSHT (0x08) or PUSHF (0x09) opcodes yet
const PUSHT = 0x08;
const PUSHF = 0x09;

function *generateInstructions(
    methods: ReadonlyArray<ContractMethod>, 
    tokens: ReadonlyArray<sc.MethodToken>,
    methodAddressMap: ReadonlyMap<Symbol, number>
): Generator<number[], void, unknown> {
    const contractOps = [...calcOperationAddresses(methods)];
    for (let index = 0; index < contractOps.length; index++) {
        const {address, op } = contractOps[index];
        if (isCallOp(op)) yield convertCall(methodAddressMap, op, address);
        else if (isCallTokenOp(op)) yield convertCallToken(op, tokens);
        else if (isConvertOp(op)) yield [sc.OpCode.CONVERT, op.type];
        else if (isInitSlotOp(op)) yield [sc.OpCode.INITSLOT, op.locals, op.params];
        else if (isJumpOffsetOp(op)) yield convertJump(index, address, op, contractOps);
        else if (isJumpTargetOp(op)) throw new Error('JumpTargetOperation not supported');
        else if (isLoadStoreOp(op)) yield convertLoadStore(op);
        else if (isPushBoolOp(op)) yield [op.value ? PUSHT : PUSHF];
        else if (isPushDataOp(op)) yield convertPushData(op);
        else if (isPushIntOp(op)) yield convertPushInt(op);
        else if (isSimpleOp(op)) yield [convertSimpleOperationKind(op.kind)];
        else if (isSysCallOp(op)) yield convertSysCall(op);
    }
}

function hasSafeTag(node: JSDocableNode): boolean {
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

function *generateManifestMethods(
    methods: ReadonlyArray<ContractMethod>, 
    methodAddressMap: ReadonlyMap<Symbol, number>
) {
    for (const method of methods) {
        if (!method.node.getExportKeyword()) continue;

        const offset = methodAddressMap.get(method.symbol);
        if (!offset) throw new Error(`${method.symbol.getName()} not found`)

        const parameters = method.node.getParameters().map(p => ({
            name: p.getName(),
            type: asContractParamType(p.getType())
        }))


        yield new sc.ContractMethodDefinition({
            name: method.symbol.getName(),
            offset,
            parameters,
            returnType: asReturnType(method.node.getReturnType()),
            safe: hasSafeTag(method.node),
        })

    }
}

interface CompileArtifacts {
    readonly nef: sc.NEF;
    readonly manifest: sc.ContractManifest;
    readonly debugInfo: DebugInfoJson;
}

export const collectArtifacts = 
    (name: string, methods: ReadonlyArray<ContractMethod>, options: CompileOptions): CompilerState<CompileArtifacts> => 
    diagnostics => {

        const tokens = collectMethodTokens(methods);
        const methodAddressMap = new Map(calcMethodAddresses(methods));
        const instructions = [...generateInstructions(methods, tokens, methodAddressMap)];

        const nef = new sc.NEF({
            compiler: "neo-devpack-ts",
            script: Buffer.from(ROA.flatten(instructions)).toString("hex"),
            tokens: tokens.map(t => t.export()),
        });
        const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();

        const manifestMethods = [...generateManifestMethods(methods, methodAddressMap)]
        const manifest = new sc.ContractManifest({
            name,
            supportedStandards: [...options.standards],
            abi: new sc.ContractAbi({ methods: manifestMethods})
        });
        
        const debugInfo: DebugInfoJson = {
            hash: `0x${hash.toString('hex')}`,
        }

        return [{ nef, manifest, debugInfo}, diagnostics];

} 
    
    
function convertSysCall({name}: SysCallOperation) {
    const code = Buffer.from(sc.generateInteropServiceCode(name), 'hex');
    return [sc.OpCode.SYSCALL, ...code];
}


function convertPushInt({ value }: PushIntOperation) {
    if (value <= 16n && value >= -1n) {
        const opCode = sc.OpCode.PUSH0 + Number(value);
        return [opCode];
    } else {
        const { opCode, buffer } = convertBigInteger(value);
        return [opCode, ...new Uint8Array(buffer)];
    }
}

function convertPushData({ value }: PushDataOperation) {
    if (value.length <= 255) /* byte.MaxValue */ {
        return [sc.OpCode.PUSHDATA1, value.length, ...value];
    }
    if (value.length <= 65535) /* ushort.MaxValue */ {
        const buffer = new ArrayBuffer(2);
        new DataView(buffer).setUint16(0, value.length, true);
        return [sc.OpCode.PUSHDATA2, ...new Uint8Array(buffer), ...value];
    }
    if (value.length <= 4294967295) /* uint.MaxValue */ {
        const buffer = new ArrayBuffer(4);
        new DataView(buffer).setUint32(0, value.length, true);
        return [sc.OpCode.PUSHDATA4, ...new Uint8Array(buffer), ...value];
    }
    throw new Error(`pushData length ${value.length} too long`);
}


function convertCall(methodAddressMap: ReadonlyMap<Symbol, number>, op: CallOperation, address: number) {
    const targetAddress = methodAddressMap.get(op.method);
    if (!targetAddress) throw new Error(`${op.method.getName()} invalid address`);
    const addressOffset = targetAddress - address;
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return [sc.OpCode.CALL_L, ...new Uint8Array(buffer)];
}

function convertJump(index: number, address: number, op: JumpOffsetOperation, contractOps: { address: number; op: Operation; }[]) {
    const targetIndex = index + op.offset;
    const targetAddress = contractOps[targetIndex].address;
    const addressOffset = targetAddress - address;
    const opCode = convertJumpOperationKind(op.kind);
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return [opCode, ...new Uint8Array(buffer)]
}

function convertCallToken({ token }: CallTokenOperation, tokens: ReadonlyArray<sc.MethodToken>) {
    const index = tokens.findIndex(t => t.hash === token.hash && t.method === token.method);
    if (index < 0) throw new Error(`convertCallToken: ${token.hash} ${token.method}`);
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setUint16(0, index, true);
    return [sc.OpCode.CALLT, ...new Uint8Array(buffer)];
}

function convertLoadStore(op: LoadStoreOperation) {
    const opCode = convertLoadStoreKind(op.kind);
    return (op.index <= 6)
        ? [opCode + op.index - 7]
        : [opCode, op.index]
}

export function asContractParamType(type: Type): sc.ContractParamType {

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

function asReturnType(type: Type) {
    return isVoidLike(type)
        ? sc.ContractParamType.Void
        : asContractParamType(type);
}




