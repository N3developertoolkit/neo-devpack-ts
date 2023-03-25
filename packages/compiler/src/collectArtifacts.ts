import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";
import { pipe } from "fp-ts/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROS from 'fp-ts/ReadonlySet'
import * as E from 'fp-ts/Either'
import * as O from 'fp-ts/Option'

import { CallOperation, CallTokenOperation, convertJumpOperationKind, convertLoadStoreKind, convertSimpleOperationKind, getOperationSize, isCallOp, isCallTokenOp, isConvertOp, isInitSlotOp, isInitStaticOperation, isJumpOffsetOp, isJumpTargetOp, isLoadStoreOp, isPushBoolOp, isPushDataOp, isPushIntOp, isSimpleOp, isSysCallOp, JumpOffsetOperation, LoadStoreOperation, Operation, PushDataOperation, PushIntOperation, SysCallOperation } from "./types/Operation";
import { convertBigInteger, createDiagnostic, E_fromSeparated, getErrorMessage } from "./utils";
import { asContractParamType, asReturnType } from "./utility/asContractParamType";
import { CompiledProject, CompiledProjectArtifacts, CompileOptions, CompilerState, ContractEvent, ContractMethod } from "./types/CompileOptions";
import { DebugInfo, DebugInfoMethod, makeDebugInfo, SequencePoint } from "./types/DebugInfo";

function collectMethodTokens(methods: ReadonlyArray<ContractMethod>): ReadonlyArray<sc.MethodToken> {
    const set = pipe(
        methods,
        ROA.map(m => m.operations),
        ROA.flatten,
        ROA.filter(isCallTokenOp),
        ROA.map(m => m.token),
        ROS.fromReadonlyArray({
            equals: (x, y) => x.hash === y.hash && x.method === y.method
        }),
    )
    return [...set.values()];
}

function* genOperationAddresses(
    methods: ReadonlyArray<ContractMethod>
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
    methods: ReadonlyArray<ContractMethod>
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

function convertJump(
    index: number, 
    address: number, 
    op: JumpOffsetOperation, 
    contractOps: ReadonlyArray<{ address: number; op: Operation; }>
): Instruction {
    const targetIndex = index + op.offset;
    const targetAddress = contractOps[targetIndex].address;
    const addressOffset = targetAddress - address;
    const opCode = convertJumpOperationKind(op.kind);
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return { opCode, operand: new Uint8Array(buffer) };
}

function convertCallToken(
    { token }: CallTokenOperation, 
    tokens: ReadonlyArray<sc.MethodToken>
): Instruction {
    const index = tokens.findIndex(t => t.hash === token.hash && t.method === token.method);
    if (index < 0) throw new Error(`convertCallToken: ${token.hash} ${token.method}`);
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setUint16(0, index, true);
    return { opCode: sc.OpCode.CALLT, operand: new Uint8Array(buffer) };
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
): Instruction {
    const targetAddress = methodAddressMap.get(op.method);
    if (!targetAddress) throw new Error(`${op.method.getName()} invalid address`);
    const addressOffset = targetAddress - address;
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, addressOffset, true);
    return { opCode: sc.OpCode.CALL_L, operand: new Uint8Array(buffer) };
}

// neon-js hasn't added the PUSHT (0x08) or PUSHF (0x09) opcodes yet
const PUSHT = 0x08;
const PUSHF = 0x09;

// TODO: convert this to 
// * not throw
// * not be a generator
// * handle multi instruction operations (such as packmap and packarray)

function* genInstructions(
    contractOps: ReadonlyArray<{ address: number; op: Operation; }>,
    tokens: ReadonlyArray<sc.MethodToken>,
    methodAddressMap: ReadonlyMap<tsm.Symbol, number>
): Generator<number[], void, unknown> {
    for (let index = 0; index < contractOps.length; index++) {
        const { address, op } = contractOps[index];
        // convertCall can throw
        // if (isCallOp(op)) yield convertCall(methodAddressMap, op, address);
        // // convertCallToken can throw
        // else if (isCallTokenOp(op)) yield convertCallToken(op, tokens);
        // else if (isConvertOp(op)) yield [sc.OpCode.CONVERT, op.type];
        // else if (isInitSlotOp(op)) yield [sc.OpCode.INITSLOT, op.locals, op.params];
        // else if (isInitStaticOperation(op)) yield [sc.OpCode.INITSSLOT, op.count];
        // else if (isJumpOffsetOp(op)) yield convertJump(index, address, op, contractOps);
        // else if (isJumpTargetOp(op)) throw new Error('JumpTargetOperation not supported');
        // else if (isLoadStoreOp(op)) yield convertLoadStore(op);
        // else if (isPushBoolOp(op)) yield [op.value ? PUSHT : PUSHF];
        // // convertPushData can throw
        // else if (isPushDataOp(op)) yield convertPushData(op);
        // else if (isPushIntOp(op)) yield convertPushInt(op);
        // else if (isSimpleOp(op)) yield [convertSimpleOperationKind(op.kind)];
        // else if (isSysCallOp(op)) yield convertSysCall(op);
        // else throw new Error(`Unknown operation`);
    }
}

function collectManifestMethods(
    methods: ReadonlyArray<ContractMethod>,
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
    events: ReadonlyArray<ContractEvent>
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

function collectDebugMethods(
    methods: ReadonlyArray<ContractMethod>
): readonly DebugInfoMethod[] {
    let address = 0;

    return pipe(
        methods,
        ROA.map(method => {
            const start = address;
            let end = start;
            const sequencePoints = new Array<SequencePoint>();
            for (const op of method.operations) {
                end = address;
                if (op.location) {
                    sequencePoints.push({ address, location: op.location })
                }
                address += getOperationSize(op);
            }
            const parameters = method.node.getParameters().map((p, index) => ({
                name: p.getName(),
                type: p.getType(),
                index
            }));

            const variables = method.variables.map((v, index) => ({
                ...v,
                index
            }));

            return {
                name: method.symbol.getName(),
                range: { start, end },
                parameters,
                returnType: method.node.getReturnType(),
                variables,
                sequencePoints
            } as DebugInfoMethod;
        })
    )
}


function collectPermissions(
    tokens: readonly sc.MethodToken[], 
    options: CompileOptions
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
    if (options.standards.includes('NEP-17')) {
        map.set("*", new Set(["onNEP17Payment"]))
    }
    if (options.standards.includes('NEP-11')) {
        map.set("*", new Set(["onNEP11Payment"]))
    }

    return [...map.entries()].map(v => {
        return new sc.ContractPermission({
            contract: v[0],
            methods: [...v[1]]
        })
    })
}

const collectArtifactsThrows =
    (name: string, options: CompileOptions) =>
        (compiledProject: CompiledProject): CompilerState<Partial<CompiledProjectArtifacts>> =>
            diagnostics => {
                const methods = compiledProject.methods;
                const contractOps = [...genOperationAddresses(methods)];
                const tokens = collectMethodTokens(methods);
                const methodAddressMap = new Map(genMethodAddresses(methods));
                // genInstructions can throw
                const instructions = [...genInstructions(contractOps, tokens, methodAddressMap)];

                const nef = new sc.NEF({
                    compiler: "neo-devpack-ts",
                    script: Buffer.from(ROA.flatten(instructions)).toString("hex"),
                    tokens: tokens.map(t => t.export()),
                });
                const hash = Buffer.from(u.hash160(nef.script), 'hex').reverse();

                // generateManifestMethods can throw
                const manifestMethods = collectManifestMethods(methods, methodAddressMap);
                if (E.isLeft(manifestMethods)) {
                    const diags = manifestMethods.left.map(v => createDiagnostic(v))
                    diagnostics = ROA.concat(diags)(diagnostics);
                    return [{}, diagnostics];
                }
                const manifestEvents = collectManifestEvents(compiledProject.events);
                const manifest = new sc.ContractManifest({
                    abi: new sc.ContractAbi({
                        methods: ROA.toArray(manifestMethods.right),
                        events: ROA.toArray(manifestEvents)
                    }),
                    name,
                    permissions: collectPermissions(tokens, options),
                    supportedStandards: [...options.standards],
                    trusts: []
                });

                const debugMethods = [...collectDebugMethods(methods)];
                const debugInfo = makeDebugInfo(nef, debugMethods);

                return [{ nef, manifest, debugInfo }, diagnostics];
            }

// wrap collectArtifactsThrows in E.tryCatch
// TODO: build a version of collectArtifactsThrows that doesn't throw
export const collectArtifacts =
    (name: string, options: CompileOptions) =>
        (compiledProject: CompiledProject): CompilerState<Partial<CompiledProjectArtifacts>> =>
            diagnostics => {
                const result = E.tryCatch(
                    () => collectArtifactsThrows(name, options)(compiledProject)(diagnostics),
                    e => createDiagnostic(getErrorMessage(e)));

                return pipe(
                    result,
                    E.match(
                        diag => [{}, ROA.append(diag)(diagnostics) as readonly tsm.ts.Diagnostic[]],
                        state => [state[0], state[1]]
                    ))
            }
