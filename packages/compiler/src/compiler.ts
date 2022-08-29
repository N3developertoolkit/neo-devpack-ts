import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { collectArtifacts } from "./collectArtifacts";
import { processFunctionDeclarationsPass } from "./passes/processFunctionDeclarations";
import { createGlobalScope, Scope } from "./scope";
import { Operation } from "./types";
import { DebugInfo, toJson as debugInfoToJson } from "./types/DebugInfo";
import { toDiagnostic } from "./utils";
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

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

export interface CompileOptions {
    readonly project: tsm.Project;
    readonly addressVersion?: number;
    readonly inline?: boolean;
    readonly optimize?: boolean;
}

export interface FunctionContext {
    readonly node: tsm.FunctionDeclaration;
    operations?: ReadonlyArray<Operation>;
}

export interface CompileArtifacts {
    nef: sc.NEF;
    manifest: sc.ContractManifest;
    debugInfo: DebugInfo;
}

export interface CompileContext {
    readonly diagnostics: Array<tsm.ts.Diagnostic>;
    readonly globals: Scope;
    readonly options: Readonly<Required<Omit<CompileOptions, 'project'>>>;
    readonly project: tsm.Project;
    readonly functions: Array<FunctionContext>;
}

export function compile(options: CompileOptions) {

    const globals = createGlobalScope(options.project);
    const context: CompileContext = {
        diagnostics: [],
        globals,
        options: {
            addressVersion: options.addressVersion ?? DEFAULT_ADDRESS_VALUE,
            inline: options.inline ?? false,
            optimize: options.optimize ?? false,
        },
        project: options.project,
        functions: []
    };

    // type CompilePass = (context: CompileContext) => void;
    const passes = [
        processFunctionDeclarationsPass,
    ] as const;

    for (const pass of passes) {
        try {
            pass(context);
        } catch (error) {
            context.diagnostics.push(toDiagnostic(error));
        }

        if (context.diagnostics.some(d => d.category == tsm.ts.DiagnosticCategory.Error)) {
            break;
        }
    }

    let artifacts: CompileArtifacts | undefined; 
    try {
        artifacts = collectArtifacts(context);
    } catch (error) {
        context.diagnostics.push(toDiagnostic(error));
    }

    return {
        diagnostics: context.diagnostics,
        artifacts,
        context
    };
}

async function exists(rootPath: fs.PathLike) {
    try {
        await fsp.access(rootPath);
        return true;
    } catch {
        return false;
    }
}
export async function saveArtifacts(artifacts: CompileArtifacts, rootPath: string, baseName: string = "contract") {
    if (await exists(rootPath) === false) { await fsp.mkdir(rootPath); }

    const nefPath = path.join(rootPath, baseName + ".nef")
    const manifestPath = path.join(rootPath, baseName + ".manifest.json");
    const debugInfoPath = path.join(rootPath, baseName + ".debug.json");

    const nef = Buffer.from(artifacts.nef.serialize(), 'hex');
    const manifest = JSON.stringify(artifacts.manifest.toJson(), null, 4);
    const debugInfo = JSON.stringify(debugInfoToJson(artifacts.debugInfo), null, 4);

    await Promise.all([
        fsp.writeFile(nefPath, nef), 
        fsp.writeFile(manifestPath, manifest),
        fsp.writeFile(debugInfoPath, debugInfo)]);
}

// function saveArtifacts(
//     rootPath: string,
//     filename: string,
//     source: string,
//     artifacts: CompileArtifacts
// ) {
//     if (!fs.existsSync(rootPath)) { fs.mkdirSync(rootPath); }
//     const basename = path.parse(filename).name;
//     const nefPath = path.join(rootPath, basename + ".nef");
//     const manifestPath = path.join(rootPath, basename + ".manifest.json");
//     const tsPath = path.join(artifactPath, filename);

//     fs.writeFileSync(nefPath, Buffer.from(artifacts.nef.serialize(), 'hex'));
//     fs.writeFileSync(manifestPath, JSON.stringify(artifacts.manifest.toJson(), null, 4));
//     fs.writeFileSync(tsPath, source);
// }

// function optimizePass(context: CompileContext): void {
//     // if (!context.options.optimize) { return; }
//     // if (!context.operations) { return; }
//     // const operations = context.operations;
//     // const length = operations.length;
//     // for (let i = 0; i < length; i++) {
//     //     const op = operations[i];
//     //     const newOp = optimizeReturn(op);
//     //     if (newOp) {
//     //         operations[i] = newOp;
//     //     }
//     // }
// }

// function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
//     return input != null;
// }

// function collectArtifactsPass(context: CompileContext): void {
//     // const name = context.name ?? "TestContract";
//     // const methods = new Array<DebugMethodInfo>();
//     // let fullScript = Buffer.from([]);

//     // for (const op of context.operations ?? []) {
//     //     const offset = fullScript.length;
//     //     const { script, sourceReferences } = compileOperation(op, fullScript.length);
//     //     const parameters = op.parameters.map(p => ({
//     //         name: p.name,
//     //         index: p.index,
//     //         type: toContractType(p.type),
//     //     }));
//     //     methods.push({
//     //         isPublic: op.isPublic,
//     //         name: op.name,
//     //         range: {
//     //             start: offset,
//     //             end: offset + script.length - 1
//     //         },
//     //         parameters,
//     //         returnType: isVoidLike(op.returnType)
//     //             ? undefined
//     //             : toContractType(op.returnType),
//     //         sourceReferences
//     //     })

//     //     fullScript = Buffer.concat([fullScript, script]);
//     // }

//     // const nef = new sc.NEF({
//     //     compiler: "neo-devpack-ts",
//     //     script: Buffer.from(fullScript).toString("hex"),
//     // })

//     // const manifest = new sc.ContractManifest({
//     //     name: name,
//     //     abi: new sc.ContractAbi({
//     //         methods: methods
//     //             .map(toMethodDef)
//     //             .filter(isNotNullOrUndefined)
//     //     })
//     // });

//     // context.artifacts = { nef, manifest, methods }
// }

// function compileOperation(
//     op: OperationInfo,
//     offset: number
// ): { script: Uint8Array; sourceReferences: Map<number, tsm.Node> } {

//     throw new Error();
//     // const [instructions, sourceReferences] = separateInstructions(op.instructions);

//     // const length = instructions.length;
//     // const insMap = new Map<Instruction, number>();
//     // let position = 0;
//     // for (let i = 0; i < length; i++) {
//     //     const ins = instructions[i];
//     //     insMap.set(ins, position);

//     //     // every instruction is at least one byte long for the opCode
//     //     position += 1;
//     //     const annotation = OpCodeAnnotations[ins.opCode];
//     //     if (annotation.operandSize) {
//     //         // if operandSize is specified, use it instead of the instruction operand
//     //         // since offset target instructions will have invalid operands
//     //         position += (annotation.operandSize);
//     //     } else if (annotation.operandSizePrefix) {
//     //         // if operandSizePrefix is specified, use the instruction operand length
//     //         position += (ins.operand!.length);
//     //     }
//     // }

//     // let script = new Array<number>();
//     // let references = new Map<number, tsm.Node>();

//     // for (let i = 0; i < length; i++) {
//     //     const node = sourceReferences.get(i)
//     //     if (node) {
//     //         references.set(offset + script.length, node);
//     //     }

//     //     const ins = instructions[i];
//     //     const annotation = OpCodeAnnotations[ins.opCode];
//     //     if (isTryOpCode(ins.opCode)) {
//     //         if (!ins.target || !ins.target.instruction) throw new Error("Missing catch offset instruction");
//     //         if (!ins.finallyTarget || !ins.finallyTarget.instruction) throw new Error("Missing finally offset instruction");
//     //         const catchOffset = insMap.get(ins.target.instruction);
//     //         if (!catchOffset) throw new Error("Invalid catch offset instruction");
//     //         const fetchOffset = insMap.get(ins.finallyTarget.instruction);
//     //         if (!fetchOffset) throw new Error("Invalid finally offset instruction");
//     //         if (annotation.operandSize === 2) {
//     //             script.push(ins.opCode, offset8(script.length, catchOffset), offset8(script.length, fetchOffset));
//     //         } else {
//     //             script.push(ins.opCode, ...offset32(script.length, catchOffset), ...offset32(script.length, fetchOffset));
//     //         }
//     //     } else if (isOffsetTargetOpCode(ins.opCode)) {
//     //         if (!ins.target || !ins.target.instruction) throw new Error("Missing target offset instruction");
//     //         const offset = insMap.get(ins.target.instruction);
//     //         if (!offset) throw new Error("Invalid target offset instruction");
//     //         if (annotation.operandSize === 1) {
//     //             script.push(ins.opCode, offset8(script.length, offset));
//     //         } else {
//     //             script.push(ins.opCode, ...offset32(script.length, offset));
//     //         }
//     //     } else {
//     //         const bytes = ins.operand ? [ins.opCode, ...ins.operand] : [ins.opCode];
//     //         script.push(...bytes);
//     //     }
//     // }

//     // return {
//     //     script: Uint8Array.from(script),
//     //     sourceReferences: references
//     // };

//     // function offset8(index: number, offset: number): number {
//     //     return offset - index;
//     // }

//     // function offset32(index: number, offset: number): Uint8Array {
//     //     const buffer = Buffer.alloc(4);
//     //     buffer.writeInt32LE(offset8(index, offset));
//     //     return buffer;
//     // }
// }

// function convertContractType(type: tsm.Type): sc.ContractParamType;
// function convertContractType(type: ContractType): sc.ContractParamType;
// function convertContractType(type: ContractType | tsm.Type): sc.ContractParamType {
//     throw new Error();
//     // if (type instanceof tsm.Type) { type = toContractType(type); }
//     // switch (type.kind) {
//     //     case ContractTypeKind.Array: return sc.ContractParamType.Array;
//     //     case ContractTypeKind.Interop: return sc.ContractParamType.InteropInterface;
//     //     case ContractTypeKind.Map: return sc.ContractParamType.Map;
//     //     case ContractTypeKind.Struct: return sc.ContractParamType.Array;
//     //     case ContractTypeKind.Unspecified: return sc.ContractParamType.Any;
//     //     case ContractTypeKind.Primitive: {
//     //         const primitive = type as PrimitiveContractType;
//     //         switch (primitive.type) {
//     //             case PrimitiveType.Address: return sc.ContractParamType.Hash160;
//     //             case PrimitiveType.Boolean: return sc.ContractParamType.Boolean;
//     //             case PrimitiveType.ByteArray: return sc.ContractParamType.ByteArray;
//     //             case PrimitiveType.Hash160: return sc.ContractParamType.Hash160;
//     //             case PrimitiveType.Hash256: return sc.ContractParamType.Hash256;
//     //             case PrimitiveType.Integer: return sc.ContractParamType.Integer;
//     //             case PrimitiveType.PublicKey: return sc.ContractParamType.PublicKey;
//     //             case PrimitiveType.Signature: return sc.ContractParamType.Signature;
//     //             case PrimitiveType.String: return sc.ContractParamType.String;
//     //             default: throw new Error(`Unrecognized PrimitiveType ${primitive.type}`);
//     //         }
//     //     }
//     //     default: throw new Error(`Unrecognized ContractTypeKind ${type.kind}`);
//     // }
// }

// function toMethodDef(method: DebugMethodInfo): sc.ContractMethodDefinition | undefined {
//     if (!method.isPublic) { return undefined; }
//     return new sc.ContractMethodDefinition({
//         name: method.name,
//         offset: method.range.start,
//         parameters: method.parameters?.map(p => ({
//             name: p.name,
//             type: convertContractType(p.type)
//         })),
//         returnType: method.returnType
//             ? convertContractType(method.returnType)
//             : sc.ContractParamType.Void,
//     });
// }

// function printDiagnostics(diags: ReadonlyArray<tsm.ts.Diagnostic>) {
//     const formatHost: tsm.ts.FormatDiagnosticsHost = {
//         getCurrentDirectory: () => tsm.ts.sys.getCurrentDirectory(),
//         getNewLine: () => tsm.ts.sys.newLine,
//         getCanonicalFileName: (fileName: string) => tsm.ts.sys.useCaseSensitiveFileNames
//             ? fileName : fileName.toLowerCase()
//     }

//     const msg = tsm.ts.formatDiagnosticsWithColorAndContext(diags, formatHost);
//     console.log(msg);
// }

// function saveArtifacts(
//     rootPath: string,
//     filename: string,
//     source: string,
//     artifacts: Immutable<CompileArtifacts>
// ) {
//     if (!fs.existsSync(rootPath)) { fs.mkdirSync(rootPath); }
//     const basename = path.parse(filename).name;
//     const nefPath = path.join(rootPath, basename + ".nef");
//     const manifestPath = path.join(rootPath, basename + ".manifest.json");
//     const tsPath = path.join(artifactPath, filename);

//     fs.writeFileSync(nefPath, Buffer.from(artifacts.nef.serialize(), 'hex'));
//     fs.writeFileSync(manifestPath, JSON.stringify(artifacts.manifest.toJson(), null, 4));
//     fs.writeFileSync(tsPath, source);
// }

// const artifactPath = path.join(
//     path.dirname(path.dirname(path.dirname(__dirname))),
//     "express", "out");

// function configureProject(): tsm.Project {
//     const project = new tsm.Project({
//         compilerOptions: {
//             experimentalDecorators: true,
//             // specify lib file directly to avoid bringing in web apis like DOM and WebWorker
//             lib: ["lib.es2020.d.ts"],
//             target: tsm.ts.ScriptTarget.ES2020,
//             moduleResolution: tsm.ts.ModuleResolutionKind.NodeJs,
//         },
//         useInMemoryFileSystem: true,
//     });

//     // load scfx definitions from framework package path
//     const scfxActualPath = path.join(__dirname, "../../framework/src/index.d.ts");
//     const scfxSourceCode = fs.readFileSync(scfxActualPath, 'utf8');

//     // add scfx definitions to fake node_modules path
//     const scfxPath = '/node_modules/@neo-project/neo-contract-framework/index.d.ts';
//     project.getFileSystem().writeFileSync(scfxPath, scfxSourceCode);
//     return project;

// }

// function testCompile(source: string, filename: string = "contract.ts") {

//     const project = configureProject();
//     project.createSourceFile(filename, source);
//     project.resolveSourceFileDependencies();

//     // console.time('getPreEmitDiagnostics');
//     const diagnostics = project.getPreEmitDiagnostics();
//     // console.timeEnd('getPreEmitDiagnostics')

//     if (diagnostics.length > 0) {
//         printDiagnostics(diagnostics.map(d => d.compilerObject));
//     } else {
//         try {
//             const results = compile({ project });
//             if (results.diagnostics.length > 0) {
//                 printDiagnostics(results.diagnostics);
//             } else {
//                 if (results.artifacts) {
//                     // dumpArtifacts(results.artifacts);
//                     saveArtifacts(artifactPath, filename, source, results.artifacts);
//                 } else {
//                     dumpOperations(results.context.operations);
//                 }
//             }
//         } catch (error) {
//             printDiagnostics([toDiagnostic(error)]);
//         }
//     }
// }

// const file = path.basename(process.argv[1]);
// if (file === "compiler.js") {
//     const testContractPath = path.join(__dirname, "../../../express/testContract.ts");
//     const testContractSourceCode = fs.readFileSync(testContractPath, 'utf8');
//     testCompile(testContractSourceCode);
// }
