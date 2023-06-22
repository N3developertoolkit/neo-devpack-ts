import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";

import { flow, pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as E from 'fp-ts/Either'
import * as S from 'fp-ts/State'
import * as ROR from 'fp-ts/ReadonlyRecord'
import { CallOperation, CallTokenOperation, convertJumpOperationKind, convertTargetOps, convertLoadStoreKind, convertSimpleOperationKind, EndTryOffsetOperation, getOperationSize, isCallOp, isCallTokenOp, isConvertOp, isEndTryOffsetOp, isEndTryTargetOp, isInitSlotOp, isInitStaticOperation, isJumpOffsetOp, isJumpTargetOp, isLoadStoreOp, isPushBoolOp, isPushDataOp, isPushIntOp, isSimpleOp, isSysCallOp, isTryOffsetOp, isTryTargetOp, JumpOffsetOperation, LoadStoreOperation, Operation, PushDataOperation, PushIntOperation, SysCallOperation, TryOffsetOperation } from "./types/Operation";
import { asContractParamType, asReturnType, convertBigInteger, createDiagnostic, E_fromSeparated } from "./utils";
import { CompiledProject, CompiledProjectArtifacts, ContractEvent, ContractMethod } from "./types/CompileOptions";
import { makeDebugInfo } from "./types/DebugInfo";

function collectMethodTokens(methods: readonly ContractMethod[]): readonly sc.MethodToken[] {
    return pipe(
        methods,
        ROA.map(m => m.operations),
        ROA.flatten,
        ROA.filter(isCallTokenOp),
        ROA.map(m => m.token),
        ROA.uniq({ equals: (x, y) => x.hash === y.hash && x.method === y.method }),
    )
}

function* genOperationAddresses(
    methods: readonly ContractMethod[]
): Generator<{ address: number; op: Operation; }> {
    let address = 0;
    for (const method of methods) {
        for (const op of method.operations) {
            yield { address, op };
            address += getOperationSize(op);
        }
    }
}

function* genMethodAddresses(
    methods: readonly ContractMethod[]
): Generator<[tsm.Symbol, number]> {
    let address = 0;
    for (const method of methods) {
        yield [method.symbol, address];
        for (const op of method.operations) {
            address += getOperationSize(op);
        }
    }
}

interface Instruction {
    opCode: sc.OpCode,
    operand?: Uint8Array
}

function convertSysCall(
    { name }: SysCallOperation
): Instruction {
    const operand = Buffer.from(sc.generateInteropServiceCode(name), 'hex');
    return { opCode: sc.OpCode.SYSCALL, operand }
}

function convertPushInt(
    { value }: PushIntOperation
): Instruction {
    if (value <= 16n && value >= -1n) {
        const opCode = sc.OpCode.PUSH0 + Number(value);
        return { opCode };
    } else {
        const { opCode, buffer: operand } = convertBigInteger(value);
        return { opCode, operand };
    }
}

function convertPushData(
    { value }: PushDataOperation
): E.Either<string, Instruction> {
    if (value.length <= 255) /* byte.MaxValue */ {
        const operand = Uint8Array.from([value.length, ...value]);
        return E.of({ opCode: sc.OpCode.PUSHDATA1, operand })
    }
    if (value.length <= 65535) /* ushort.MaxValue */ {
        const buffer = new ArrayBuffer(2);
        new DataView(buffer).setUint16(0, value.length, true);
        const operand = Uint8Array.from([...new Uint8Array(buffer), ...value]);

        return E.of({ opCode: sc.OpCode.PUSHDATA2, operand });
    }
    if (value.length <= 4294967295) /* uint.MaxValue */ {
        const buffer = new ArrayBuffer(4);
        new DataView(buffer).setUint32(0, value.length, true);
        const operand = Uint8Array.from([...new Uint8Array(buffer), ...value]);
        return E.of({ opCode: sc.OpCode.PUSHDATA4, operand });
    }
    return E.left(`pushData length ${value.length} too long`);
}

function convertAddressOffset(
    index: number,
    address: number,
    offset: number | undefined,
    contractOps: readonly { address: number; op: Operation; }[]
) {
    if (!offset) return 0;
    const targetIndex = index + offset;
    const targetAddress = contractOps[targetIndex].address;
    const addressOffset = targetAddress - address;
    return addressOffset;
}

function convertJump(
    index: number,
    address: number,
    { kind, offset}: JumpOffsetOperation,
    contractOps: readonly { address: number; op: Operation; }[]
): Instruction {
    const addressOffset = convertAddressOffset(index, address, offset, contractOps);
    const opCode = convertJumpOperationKind(kind);
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return { opCode, operand: new Uint8Array(buffer) };
}

function convertTry(
    index: number,
    address: number,
    { catchOffset, finallyOffset }: TryOffsetOperation,
    contractOps: readonly { address: number; op: Operation; }[]
): Instruction {
    const catchAddressOffset = convertAddressOffset(index, address, catchOffset, contractOps);
    const finallyAddressOffset = convertAddressOffset(index, address, finallyOffset, contractOps);
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setInt32(0, catchAddressOffset, true);
    view.setInt32(4, finallyAddressOffset, true);
    return { opCode: sc.OpCode.TRY_L, operand: new Uint8Array(buffer) };
}


function convertEndTry(
    index: number,
    address: number,
    { offset }: EndTryOffsetOperation,
    contractOps: readonly { address: number; op: Operation; }[]
): Instruction {
    const addressOffset = convertAddressOffset(index, address, offset, contractOps);
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return { opCode: sc.OpCode.ENDTRY_L, operand: new Uint8Array(buffer) };
}

function convertCallToken(
    { token }: CallTokenOperation,
    tokens: readonly sc.MethodToken[]
): E.Either<string, Instruction> {
    const index = tokens.findIndex(t => t.hash === token.hash && t.method === token.method);
    if (index < 0) return E.left(`convertCallToken: ${token.hash} ${token.method}`);
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setUint16(0, index, true);
    return E.of({ opCode: sc.OpCode.CALLT, operand: new Uint8Array(buffer) });
}

function convertLoadStore(
    op: LoadStoreOperation
): Instruction {
    const opCode = convertLoadStoreKind(op.kind);
    return (op.index <= 6)
        ? { opCode: opCode + op.index - 7 }
        : { opCode, operand: Uint8Array.from([op.index]) }
}


function convertCall(
    methodAddressMap: ReadonlyMap<tsm.Symbol, number>,
    op: CallOperation,
    address: number
): E.Either<string, Instruction> {
    const targetAddress = methodAddressMap.get(op.method);
    if (targetAddress === undefined) return E.left(`${op.method.getName()} invalid address`);
    const addressOffset = targetAddress - address;
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return E.of({ opCode: sc.OpCode.CALL_L, operand: new Uint8Array(buffer) });
}



function convertOperations(
    contractOps: readonly { address: number; op: Operation; }[],
    tokens: readonly sc.MethodToken[],
    methodAddressMap: ReadonlyMap<tsm.Symbol, number>
): E.Either<readonly string[], readonly Instruction[]> {
    function createIns(opCode: sc.OpCode, operand?: Uint8Array | number[]) {
        operand = operand
            ? operand instanceof Uint8Array
                ? operand
                : Uint8Array.from(operand)
            : undefined;
        return { opCode, operand };
    }

    function convert(index: number, address: number, op: Operation): E.Either<string, Instruction> {
        if (isCallOp(op)) return convertCall(methodAddressMap, op, address);
        else if (isCallTokenOp(op)) return convertCallToken(op, tokens);
        else if (isConvertOp(op)) return E.of(createIns(sc.OpCode.CONVERT, [op.type]));
        else if (isInitSlotOp(op)) return E.of(createIns(sc.OpCode.INITSLOT, [op.locals, op.params]));
        else if (isInitStaticOperation(op)) return E.of(createIns(sc.OpCode.INITSSLOT, [op.count]));
        else if (isJumpOffsetOp(op)) return E.of(convertJump(index, address, op, contractOps));
        else if (isLoadStoreOp(op)) return E.of(convertLoadStore(op));
        else if (isPushBoolOp(op)) return E.of(createIns(op.value ? sc.OpCode.PUSHT : sc.OpCode.PUSHF));
        else if (isPushDataOp(op)) return convertPushData(op);
        else if (isPushIntOp(op)) return E.of(convertPushInt(op));
        else if (isSimpleOp(op)) return E.of(createIns(convertSimpleOperationKind(op.kind)));
        else if (isSysCallOp(op)) return E.of(convertSysCall(op));
        else if (isTryOffsetOp(op)) return E.of(convertTry(index, address, op, contractOps));
        else if (isEndTryOffsetOp(op)) return E.of(convertEndTry(index, address, op, contractOps));
        else if (isJumpTargetOp(op)) return E.left('JumpTargetOperation not supported');
        else if (isTryTargetOp(op)) return E.left('TryTargetOperation not supported');
        else if (isEndTryTargetOp(op)) return E.left('EndTryTargetOperation not supported');
        return E.left(`Unknown operation "${(op as Operation).kind}"`);
    }

    return pipe(
        contractOps,
        ROA.mapWithIndex((index, { address, op }) => convert(index, address, op)),
        ROA.separate,
        E_fromSeparated,
    );
}

function collectManifestMethods(
    methods: readonly ContractMethod[],
    methodAddressMap: ReadonlyMap<tsm.Symbol, number>
): E.Either<readonly string[], readonly sc.ContractMethodDefinition[]> {
    return pipe(
        methods,
        ROA.filter(m => !!m.node.getExportKeyword()),
        ROA.map(m => {
            const offset = methodAddressMap.get(m.symbol);
            if (offset === undefined) return E.left(`${m.symbol.getName()} not found`);
            const parameters = m.node.getParameters().map(p => ({
                name: p.getName(),
                type: asContractParamType(p.getType())
            }))

            const manifestMethod = new sc.ContractMethodDefinition({
                name: m.symbol.getName(),
                offset,
                parameters,
                returnType: asReturnType(m.node.getReturnType()),
                safe: hasSafeTag(m.node),
            })
            return E.of(manifestMethod);
        }),
        ROA.separate,
        E_fromSeparated
    )

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
}

function collectManifestEvents(
    events: readonly ContractEvent[]
): readonly sc.ContractEventDefiniton[] {
    return pipe(
        events,
        ROA.map(e => {
            const parameters = e.node.getParameters().map(p => ({
                name: p.getName(),
                type: asContractParamType(p.getType())
            }))
            return new sc.ContractEventDefiniton({
                name: e.symbol.getName(),
                parameters
            })
        })
    )
}

function collectPermissions(
    tokens: readonly sc.MethodToken[],
    standards: readonly string[],
): sc.ContractPermission[] {

    const map = new Map<string, ReadonlySet<string>>();
    for (const token of tokens) {
        const hash = u.HexString.fromHex(token.hash, true).toString();
        const methodSet = map.get(hash) ?? new Set<string>();
        const newSet = new Set<string>(methodSet);
        newSet.add(token.method);
        map.set(hash, newSet);
    }

    // TODO: user specified mechanism (source declarative or cli parameter) mechanism to add permissions
    if (standards.includes('NEP-17')) {
        map.set("*", new Set(["onNEP17Payment"]))
    }
    if (standards.includes('NEP-11')) {
        map.set("*", new Set(["onNEP11Payment"]))
    }

    return [...map.entries()].map(v => {
        return new sc.ContractPermission({
            contract: v[0],
            methods: [...v[1]]
        })
    })
}

export interface CollectArtifactOptions {
    readonly contractName: string;
    readonly standards?: readonly string[];
    readonly extras?: readonly (readonly [string, string])[]
}

export const collectArtifacts =
    (options: CollectArtifactOptions) =>
        (compiledProject: CompiledProject): S.State<readonly tsm.ts.Diagnostic[], Partial<CompiledProjectArtifacts>> =>
            diagnostics => {
                const { contractName } = options;
                const { left:jumpConvertErrors, right: methods} = pipe(
                    compiledProject.methods,
                    ROA.map(method => pipe(
                        method.operations,
                        convertTargetOps,
                        E.map(operations => ({ ...method, operations } as ContractMethod))
                    )),
                    ROA.separate
                );
                
                if (jumpConvertErrors.length > 0) {
                    diagnostics = ROA.concat(jumpConvertErrors.map(e => createDiagnostic(e)))(diagnostics);
                    return [{}, diagnostics];
                }

                const contractOps = [...genOperationAddresses(methods)];
                const tokens = collectMethodTokens(methods);
                const methodAddressMap = new Map(genMethodAddresses(methods));

                return pipe(
                    convertOperations(contractOps, tokens, methodAddressMap),
                    E.map(ROA.map(ins => ins.operand ? [ins.opCode, ...ins.operand] : [ins.opCode])),
                    E.map(ROA.flatten),
                    E.map(bytes => new sc.NEF({
                        compiler: "neo-devpack-ts",
                        script: Buffer.from(bytes).toString("hex"),
                        tokens: tokens.map(t => t.export()),
                    })),
                    E.bindTo('nef'),
                    E.bind('debugInfo', ({ nef }) => E.of(makeDebugInfo(compiledProject, nef))),
                    E.bind('manifest', () => {
                        return pipe(
                            collectManifestMethods(methods, methodAddressMap),
                            E.map(methods => {
                                const events = collectManifestEvents(compiledProject.events);
                                const standards = ROA.toArray(options.standards ?? []);
                                const extra = ROR.fromEntries(options.extras ?? []);
                                return new sc.ContractManifest({
                                    abi: new sc.ContractAbi({
                                        methods: ROA.toArray(methods),
                                        events: ROA.toArray(events)
                                    }),
                                    name: contractName,
                                    permissions: collectPermissions(tokens, standards),
                                    supportedStandards: standards,
                                    trusts: [],
                                    extra,
                                });
                            }
                            )
                        );
                    }),
                    E.mapLeft(flow(ROA.map(createDiagnostic), ROA.concat(diagnostics))),
                    E.match(
                        diagnostics => [{}, diagnostics] as [Partial<CompiledProjectArtifacts>, readonly tsm.ts.Diagnostic[]],
                        artifacts => [artifacts, diagnostics] as [Partial<CompiledProjectArtifacts>, readonly tsm.ts.Diagnostic[]],
                    )
                );
            }


