import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import * as tsmc from "@ts-morph/common";
import * as fs from 'fs';
import * as path from 'path';
import { ContractType, } from "./types/ContractType";
import { dumpArtifacts, dumpOperations } from "./testUtils";
import { optimizeReturn } from "./optimizations";
import { Immutable } from "./utility/Immutable";
import { resolveBuiltinsPass } from "./passes/resolveBuiltins";
import { discoverOperationsPass } from "./passes/discoverOperations";
import { processOperationsPass } from "./passes/processOperations";
import { CompileArtifacts, CompileContext, CompileOptions, CompileResults, OperationInfo } from "./types/CompileContext";
import { DebugMethodInfo } from "./types/DebugInfo";

// https://github.com/CityOfZion/neon-js/issues/858
const DEFAULT_ADDRESS_VALUE = 53;

export class CompileError extends Error {
    constructor(
        message: string,
        public readonly node: tsm.Node
    ) {
        super(message);
    }
}

function compile(options: CompileOptions): CompileResults {

    const context: CompileContext = {
        project: options.project,
        declarationFiles: options.declarationFiles,
        options: {
            addressVersion: options.addressVersion ?? DEFAULT_ADDRESS_VALUE,
            inline: options.inline ?? false,
            optimize: options.optimize ?? false,
        },
        diagnostics: []
    };

    type CompilePass = (context: CompileContext) => void;
    const passes: ReadonlyArray<CompilePass> = [
        resolveBuiltinsPass,
        discoverOperationsPass,
        processOperationsPass,
        optimizePass,
        collectArtifactsPass,
    ] as const;

    for (const pass of passes) {
        try {
            pass(context);
        } catch (error) {
            const messageText = error instanceof Error
                ? error.message
                : "unknown error";
            const node = error instanceof CompileError
                ? error.node
                : undefined;
            if (!context.diagnostics) { context.diagnostics = []; }
            context.diagnostics.push({
                category: tsm.ts.DiagnosticCategory.Error,
                code: 0,
                file: node?.getSourceFile().compilerNode,
                length: node
                    ? node.getEnd() - node.getPos()
                    : undefined,
                messageText,
                start: node?.getPos(),
                source: node?.print()
            });
        }

        if (context.diagnostics?.some(d => d.category == tsm.ts.DiagnosticCategory.Error)) {
            break;
        }
    }

    return {
        diagnostics: context.diagnostics,
        artifacts: context.artifacts,
        context
    };
}





function optimizePass(context: CompileContext): void {
    // if (!context.options.optimize) { return; }
    // if (!context.operations) { return; }
    // const operations = context.operations;
    // const length = operations.length;
    // for (let i = 0; i < length; i++) {
    //     const op = operations[i];
    //     const newOp = optimizeReturn(op);
    //     if (newOp) {
    //         operations[i] = newOp;
    //     }
    // }
}

function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
    return input != null;
}

function collectArtifactsPass(context: CompileContext): void {
    // const name = context.name ?? "TestContract";
    // const methods = new Array<DebugMethodInfo>();
    // let fullScript = Buffer.from([]);

    // for (const op of context.operations ?? []) {
    //     const offset = fullScript.length;
    //     const { script, sourceReferences } = compileOperation(op, fullScript.length);
    //     const parameters = op.parameters.map(p => ({
    //         name: p.name,
    //         index: p.index,
    //         type: toContractType(p.type),
    //     }));
    //     methods.push({
    //         isPublic: op.isPublic,
    //         name: op.name,
    //         range: {
    //             start: offset,
    //             end: offset + script.length - 1
    //         },
    //         parameters,
    //         returnType: isVoidLike(op.returnType)
    //             ? undefined
    //             : toContractType(op.returnType),
    //         sourceReferences
    //     })

    //     fullScript = Buffer.concat([fullScript, script]);
    // }

    // const nef = new sc.NEF({
    //     compiler: "neo-devpack-ts",
    //     script: Buffer.from(fullScript).toString("hex"),
    // })

    // const manifest = new sc.ContractManifest({
    //     name: name,
    //     abi: new sc.ContractAbi({
    //         methods: methods
    //             .map(toMethodDef)
    //             .filter(isNotNullOrUndefined)
    //     })
    // });

    // context.artifacts = { nef, manifest, methods }
}

function compileOperation(
    op: OperationInfo,
    offset: number
): { script: Uint8Array; sourceReferences: Map<number, tsm.Node> } {

    throw new Error();
    // const [instructions, sourceReferences] = separateInstructions(op.instructions);

    // const length = instructions.length;
    // const insMap = new Map<Instruction, number>();
    // let position = 0;
    // for (let i = 0; i < length; i++) {
    //     const ins = instructions[i];
    //     insMap.set(ins, position);

    //     // every instruction is at least one byte long for the opCode
    //     position += 1;
    //     const annotation = OpCodeAnnotations[ins.opCode];
    //     if (annotation.operandSize) {
    //         // if operandSize is specified, use it instead of the instruction operand
    //         // since offset target instructions will have invalid operands
    //         position += (annotation.operandSize);
    //     } else if (annotation.operandSizePrefix) {
    //         // if operandSizePrefix is specified, use the instruction operand length
    //         position += (ins.operand!.length);
    //     }
    // }

    // let script = new Array<number>();
    // let references = new Map<number, tsm.Node>();

    // for (let i = 0; i < length; i++) {
    //     const node = sourceReferences.get(i)
    //     if (node) {
    //         references.set(offset + script.length, node);
    //     }

    //     const ins = instructions[i];
    //     const annotation = OpCodeAnnotations[ins.opCode];
    //     if (isTryOpCode(ins.opCode)) {
    //         if (!ins.target || !ins.target.instruction) throw new Error("Missing catch offset instruction");
    //         if (!ins.finallyTarget || !ins.finallyTarget.instruction) throw new Error("Missing finally offset instruction");
    //         const catchOffset = insMap.get(ins.target.instruction);
    //         if (!catchOffset) throw new Error("Invalid catch offset instruction");
    //         const fetchOffset = insMap.get(ins.finallyTarget.instruction);
    //         if (!fetchOffset) throw new Error("Invalid finally offset instruction");
    //         if (annotation.operandSize === 2) {
    //             script.push(ins.opCode, offset8(script.length, catchOffset), offset8(script.length, fetchOffset));
    //         } else {
    //             script.push(ins.opCode, ...offset32(script.length, catchOffset), ...offset32(script.length, fetchOffset));
    //         }
    //     } else if (isOffsetTargetOpCode(ins.opCode)) {
    //         if (!ins.target || !ins.target.instruction) throw new Error("Missing target offset instruction");
    //         const offset = insMap.get(ins.target.instruction);
    //         if (!offset) throw new Error("Invalid target offset instruction");
    //         if (annotation.operandSize === 1) {
    //             script.push(ins.opCode, offset8(script.length, offset));
    //         } else {
    //             script.push(ins.opCode, ...offset32(script.length, offset));
    //         }
    //     } else {
    //         const bytes = ins.operand ? [ins.opCode, ...ins.operand] : [ins.opCode];
    //         script.push(...bytes);
    //     }
    // }

    // return {
    //     script: Uint8Array.from(script),
    //     sourceReferences: references
    // };

    // function offset8(index: number, offset: number): number {
    //     return offset - index;
    // }

    // function offset32(index: number, offset: number): Uint8Array {
    //     const buffer = Buffer.alloc(4);
    //     buffer.writeInt32LE(offset8(index, offset));
    //     return buffer;
    // }
}

export function convertContractType(type: tsm.Type): sc.ContractParamType;
export function convertContractType(type: ContractType): sc.ContractParamType;
export function convertContractType(type: ContractType | tsm.Type): sc.ContractParamType {
    throw new Error();
    // if (type instanceof tsm.Type) { type = toContractType(type); }
    // switch (type.kind) {
    //     case ContractTypeKind.Array: return sc.ContractParamType.Array;
    //     case ContractTypeKind.Interop: return sc.ContractParamType.InteropInterface;
    //     case ContractTypeKind.Map: return sc.ContractParamType.Map;
    //     case ContractTypeKind.Struct: return sc.ContractParamType.Array;
    //     case ContractTypeKind.Unspecified: return sc.ContractParamType.Any;
    //     case ContractTypeKind.Primitive: {
    //         const primitive = type as PrimitiveContractType;
    //         switch (primitive.type) {
    //             case PrimitiveType.Address: return sc.ContractParamType.Hash160;
    //             case PrimitiveType.Boolean: return sc.ContractParamType.Boolean;
    //             case PrimitiveType.ByteArray: return sc.ContractParamType.ByteArray;
    //             case PrimitiveType.Hash160: return sc.ContractParamType.Hash160;
    //             case PrimitiveType.Hash256: return sc.ContractParamType.Hash256;
    //             case PrimitiveType.Integer: return sc.ContractParamType.Integer;
    //             case PrimitiveType.PublicKey: return sc.ContractParamType.PublicKey;
    //             case PrimitiveType.Signature: return sc.ContractParamType.Signature;
    //             case PrimitiveType.String: return sc.ContractParamType.String;
    //             default: throw new Error(`Unrecognized PrimitiveType ${primitive.type}`);
    //         }
    //     }
    //     default: throw new Error(`Unrecognized ContractTypeKind ${type.kind}`);
    // }
}

function toMethodDef(method: DebugMethodInfo): sc.ContractMethodDefinition | undefined {
    if (!method.isPublic) { return undefined; }
    return new sc.ContractMethodDefinition({
        name: method.name,
        offset: method.range.start,
        parameters: method.parameters?.map(p => ({
            name: p.name,
            type: convertContractType(p.type)
        })),
        returnType: method.returnType
            ? convertContractType(method.returnType)
            : sc.ContractParamType.Void,
    });
}

function printDiagnostic(diags: ReadonlyArray<tsm.ts.Diagnostic>) {
    const formatHost: tsm.ts.FormatDiagnosticsHost = {
        getCurrentDirectory: () => tsm.ts.sys.getCurrentDirectory(),
        getNewLine: () => tsm.ts.sys.newLine,
        getCanonicalFileName: (fileName: string) => tsm.ts.sys.useCaseSensitiveFileNames
            ? fileName : fileName.toLowerCase()
    }

    const msg = tsm.ts.formatDiagnosticsWithColorAndContext(diags, formatHost);
    console.log(msg);
}

function saveArtifacts(
    rootPath: string,
    filename: string,
    source: string,
    artifacts: Immutable<CompileArtifacts>
) {
    if (!fs.existsSync(rootPath)) { fs.mkdirSync(rootPath); }
    const basename = path.parse(filename).name;
    const nefPath = path.join(rootPath, basename + ".nef");
    const manifestPath = path.join(rootPath, basename + ".manifest.json");
    const tsPath = path.join(artifactPath, filename);

    fs.writeFileSync(nefPath, Buffer.from(artifacts.nef.serialize(), 'hex'));
    fs.writeFileSync(manifestPath, JSON.stringify(artifacts.manifest.toJson(), null, 4));
    fs.writeFileSync(tsPath, source);
}


const artifactPath = path.join(
    path.dirname(path.dirname(path.dirname(__dirname))),
    "express", "out");

function testCompile(source: string, filename: string = "contract.ts") {

    const libFolderPath: string | undefined = undefined;
    const skipLoadingLibFiles: boolean | undefined = true;

    const defaultLibFileName = "lib.es5.d.ts";
    const defaultLibSourceCode = tsmc.getLibFiles().find(value => value.fileName === defaultLibFileName)?.text;
    if (!defaultLibSourceCode) throw new Error();
    const defaultLibFolder = tsmc.getLibFolderPath({ libFolderPath, skipLoadingLibFiles });
    const defaultLibPath = path.join(defaultLibFolder, defaultLibFileName);

    const scfxPath = '/node_modules/@neo-project/neo-contract-framework/index.d.ts';
    const scfxActualPath = path.join(__dirname, "../../framework/src/index.d.ts");
    const scfxSourceCode = fs.readFileSync(scfxActualPath, 'utf8');

    const project = new tsm.Project({
        compilerOptions: {
            experimentalDecorators: true,
            lib: [defaultLibFileName],
        },
        useInMemoryFileSystem: true,
        libFolderPath,
        skipLoadingLibFiles
    });

    project.getFileSystem().writeFileSync(defaultLibPath, defaultLibSourceCode);
    project.getFileSystem().writeFileSync(scfxPath, scfxSourceCode);
    project.createSourceFile(filename, source);
    project.resolveSourceFileDependencies();

    console.time('getPreEmitDiagnostics');
    const diagnostics = project.getPreEmitDiagnostics();
    console.timeEnd('getPreEmitDiagnostics')

    if (diagnostics.length > 0) {
        printDiagnostic(diagnostics.map(d => d.compilerObject));
    } else {
        const defaultLibSourceFile = project.getSourceFileOrThrow(defaultLibPath);
        const scfxLibSourceFile = project.getSourceFileOrThrow(scfxPath);
        const results = compile({
            project,
            declarationFiles: [
                defaultLibSourceFile,
                scfxLibSourceFile]
        });
        if (results.diagnostics.length > 0) {
            printDiagnostic(results.diagnostics);
        } else {
            if (results.artifacts) {
                dumpArtifacts(results.artifacts);
                saveArtifacts(artifactPath, filename, source, results.artifacts);
            } else {
                dumpOperations(results.context.operations);
            }
        }
    }
}

const file = path.basename(process.argv[1]);
if (file === "compiler.js") {
    console.log('test compile');

    const foo = Object.keys(sc.OpCode)
        .filter(k => isNaN(Number(k)))
        .map(k => `case sc.OpCode.${k}:`);
    for (const x of foo) { console.log(x); }
    throw new Error();

    const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

export function symbol() { return "TOKEN"; }
export function decimals() { return 8; }

export function getValue() { 
    return neo.Storage.get(neo.Storage.currentContext, Uint8Array.from([0x00])); 
}

export function setValue(value: string) { 
    neo.Storage.put(neo.Storage.currentContext, Uint8Array.from([0x00]), value); 
}

export function helloWorld() { return "Hello, World!"; }

export function sayHello(name: string) { return "Hello, " + name + "!"; }
`;

    testCompile(contractSource);
}
