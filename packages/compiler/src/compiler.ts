import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { ContractType, } from "./types/ContractType";
import { Immutable } from "./utility/Immutable";
import { createSymbolTable } from "./symbolTable";
import { processFunctionDeclarationsPass } from "./passes/processOperations";
import { CompileArtifacts, CompileContext, OperationInfo } from "./types/CompileContext";
import { DebugMethodInfo } from "./types/DebugInfo";
import { getNumericLiteral, getSymbolOrCompileError } from "./utils";
import { ReadonlyUint8Array } from "./utility/ReadonlyArrays";

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
    project: tsm.Project;
    addressVersion?: number;
    inline?: boolean;
    optimize?: boolean;
}

// export interface CompileResults {
//     readonly diagnostics: ReadonlyArray<tsm.ts.Diagnostic>,
//     readonly artifacts?: Immutable<CompileArtifacts>,
//     readonly context: Immutable<Omit<CompileContext, 'diagnostics' | 'artifacts'>>
// }

// @internal
export function getConstantValue(node: tsm.VariableDeclaration) {
    const kind = node.getVariableStatementOrThrow().getDeclarationKind();
    if (kind !== tsm.VariableDeclarationKind.Const) return undefined;

    const init = node.getInitializerOrThrow();
    switch (init.getKind()) {
        case tsm.SyntaxKind.NullKeyword:
            return null;
        case tsm.SyntaxKind.BigIntLiteral: 
            return (init as tsm.BigIntLiteral).getLiteralValue() as bigint;
        case tsm.SyntaxKind.NumericLiteral: {
            const literal = getNumericLiteral(init as tsm.NumericLiteral);
            return BigInt(literal);
        }
        case tsm.SyntaxKind.FalseKeyword:
            return false;
        case tsm.SyntaxKind.TrueKeyword:
            return true;
        case tsm.SyntaxKind.StringLiteral: {
            const literal = (init as tsm.StringLiteral).getLiteralValue();
            return <ReadonlyUint8Array>Buffer.from(literal, 'utf8');
        }
        // case tsm.SyntaxKind.ArrayLiteralExpression: {
        //     const buffer = new Array<number>();
        //     for (const e of (init as tsm.ArrayLiteralExpression).getElements()) {
        //         if (tsm.Node.isNumericLiteral(e)) {
        //             buffer.push(getNumericLiteral(e) % 256);
        //         } else {
        //             return undefined;
        //         }
        //     }
        //     return Uint8Array.from(buffer);
        // }
        default:
            return undefined;
    }
}

interface Scope {
    readonly parentScope: Scope | undefined;
    readonly symbols: IterableIterator<SymbolDef>;
    define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T;
    resolve(symbol: tsm.Symbol): SymbolDef | undefined;
}

interface SymbolDef {
    readonly symbol: tsm.Symbol;
    readonly parentScope: Scope;
}

export class ConstantSymbolDef implements SymbolDef {
    constructor(
        readonly symbol: tsm.Symbol,
        readonly parentScope: Scope,
        readonly value: boolean | bigint | null | ReadonlyUint8Array,
    ) {
    }
}

// @internal
export class SymbolMap {
    private readonly map = new Map<tsm.Symbol, SymbolDef>();

    constructor(readonly scope: Scope) { }

    get symbols() { return this.map.values(); }

    define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T {
        const instance = typeof factory === 'function' ? factory(this.scope) : factory;
        if (instance.parentScope !== this.scope) {
            throw new Error(`Invalid scope for ${instance.symbol.getName()}`);
        }
        if (this.map.has(instance.symbol)) {
            throw new Error(`${instance.symbol.getName()} already defined in this scope`);
        }
        this.map.set(instance.symbol, instance);
        return instance;
    }

    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        const symbolDef = this.map.get(symbol);
        return symbolDef ?? this.scope.parentScope?.resolve(symbol);
    }
}

// @internal
export class FunctionSymbolDef implements SymbolDef, Scope {
    private readonly map: SymbolMap;
    readonly symbol: tsm.Symbol;

    constructor(
        readonly node: tsm.FunctionDeclaration,
        readonly parentScope: Scope,
    ) {
        this.map = new SymbolMap(this);
        this.symbol = getSymbolOrCompileError(node);
    }

    get symbols() { return this.map.symbols; }
    define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T {
        return this.map.define(factory);
    }
    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        return this.map.resolve(symbol);
    }
}

// @internal
export class GlobalScope implements Scope {
    private readonly map: SymbolMap;
    readonly parentScope = undefined;

    constructor() {
        this.map = new SymbolMap(this);
    }

    get symbols() { return this.map.symbols; }
    define<T extends SymbolDef>(factory: T | ((scope: Scope) => T)): T {
        return this.map.define(factory);
    }
    resolve(symbol: tsm.Symbol): SymbolDef | undefined {
        return this.map.resolve(symbol);
    }
}

// @internal
export function createGlobalScope(project: tsm.Project) {
    const globals = new GlobalScope();
    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                globals.define(s => new FunctionSymbolDef(node, s));
            }
            else if (tsm.Node.isVariableStatement(node)
                && node.getDeclarationKind() === tsm.VariableDeclarationKind.Const
            ) {
                for (const decl of node.getDeclarations()) {
                    const value = getConstantValue(decl);
                    if (value !== undefined) {
                        const symbol = decl.getSymbol();
                        if (symbol) {
                            globals.define(s => new ConstantSymbolDef(symbol, s, value));
                        }
                    }
                }
            }
        });
    }
    return globals;
}

export function compile(options: CompileOptions) {

    const globals = createSymbolTable(options.project);

    // const context: CompileContext = {
    //     project: options.project,
    //     options: {
    //         addressVersion: options.addressVersion ?? DEFAULT_ADDRESS_VALUE,
    //         inline: options.inline ?? false,
    //         optimize: options.optimize ?? false,
    //     },
    //     globals,
    //     diagnostics: [],
    //     operations: [],
    // };

    // type CompilePass = (context: CompileContext) => void;
    // const passes: ReadonlyArray<CompilePass> = [
    //     processFunctionDeclarationsPass,
    //     // optimizePass,
    //     // collectArtifactsPass,
    // ] as const;

    // for (const pass of passes) {
    //     try {
    //         pass(context);
    //     } catch (error) {
    //         context.diagnostics.push(toDiagnostic(error));
    //     }

    //     if (context.diagnostics?.some(d => d.category == tsm.ts.DiagnosticCategory.Error)) {
    //         break;
    //     }
    // }

    // return {
    //     diagnostics: context.diagnostics,
    //     artifacts: context.artifacts,
    //     // context
    // };
}

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
