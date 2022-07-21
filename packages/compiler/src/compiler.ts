import { sc, u } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import * as fs from 'fs';
import * as path from 'path';
import { OffsetTarget, ScriptBuilder } from "./ScriptBuilder";
import { convertStatement } from "./convert";
import { ContractType, ContractTypeKind, PrimitiveContractType, PrimitiveType, toContractType } from "./contractType";
import { isVoidLike } from "./utils";
import { dumpArtifacts, dumpOperations } from "./testUtils";

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
    project: tsm.Project,
    optimize?: boolean,
    inline?: boolean,
    addressVersion?: number
};

export interface CompilationContext {
    project: tsm.Project,
    options: Required<Omit<CompileOptions, 'project'>>,
    name?: string,
    builtins?: Builtins,
    operations?: Array<OperationContext>,
    staticFields?: Array<StaticField>,
    diagnostics: Array<tsm.ts.Diagnostic>,
    artifacts?: CompilationArtifacts
}

export interface DebugSlotVariable {
    name: string;
    type: ContractType;
    index?: number;
}

export interface DebugMethodInfo {
    isPublic: boolean,
    name: string,
    range: { start: number, end: number }
    parameters?: DebugSlotVariable[],
    variables?: DebugSlotVariable[],
    returnType?: ContractType,
    sourceReferences: Map<number, tsm.Node>,
}

export interface CompilationArtifacts {
    nef: sc.NEF,
    manifest: sc.ContractManifest,
    methods: DebugMethodInfo[]
}

export interface SysCall {
    syscall: string,
}

// adding type alias so we can add other types of VM calls later
export type VmCall = SysCall;

export interface Builtins {
    variables: ReadonlyMap<tsm.Symbol, tsm.Symbol>,
    interfaces: ReadonlyMap<tsm.Symbol, Map<tsm.Symbol, VmCall[]>>,
}

export interface OperationContext {
    readonly parent: CompilationContext,
    readonly name: string,
    readonly isPublic: boolean,
    readonly node: tsm.FunctionDeclaration,
    readonly builder: ScriptBuilder,
    readonly returnTarget: OffsetTarget,
}

export interface StaticField { }

export interface CompileResults {
    diagnostics: Array<tsm.ts.Diagnostic>,
    artifacts?: CompilationArtifacts,
    context: Omit<CompilationContext, 'diagnostics' | 'artifacts'>

}

function compile(options: CompileOptions): CompileResults {

    const context: CompilationContext = {
        project: options.project,
        options: {
            addressVersion: options.addressVersion ?? DEFAULT_ADDRESS_VALUE,
            inline: options.inline ?? false,
            optimize: options.optimize ?? false,
        },
        diagnostics: []
    };

    type CompilePass = (context: CompilationContext) => void;
    const passes: Array<CompilePass> = [
        resolveDeclarationsPass,
        processFunctionsPass,
        collectArtifactsPass,
    ];

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

function resolveDeclarationsPass(context: CompilationContext): void {

    // TODO: move this to a JSON file at some point
    const storageBuiltin = new Map<string, VmCall[]>([
        ["currentContext", [{ syscall: "System.Storage.GetContext" }]],
        ["get", [{ syscall: "System.Storage.Get" }]],
        ["put", [{ syscall: "System.Storage.Put" }]]
    ]);

    const builtinInterfaces = new Map([
        ["StorageConstructor", storageBuiltin]
    ]);

    const interfaces = new Map<tsm.Symbol, Map<tsm.Symbol, VmCall[]>>();
    const variables = new Map<tsm.Symbol, tsm.Symbol>();

    for (const src of context.project.getSourceFiles()) {
        if (!src.isDeclarationFile()) continue;

        src.forEachChild(node => {
            if (node.isKind(tsm.ts.SyntaxKind.InterfaceDeclaration)) {
                const symbol = node.getSymbol();
                if (!symbol) return;
                const iface = builtinInterfaces.get(symbol.getName());
                if (!iface) return;
                const members = new Map<tsm.Symbol, VmCall[]>();
                for (const member of node.getMembers()) {
                    const memberSymbol = member.getSymbol();
                    if (!memberSymbol) return;
                    const calls = iface.get(memberSymbol.getName());
                    if (calls && calls.length > 0) {
                        members.set(memberSymbol, calls);
                    }
                }
                interfaces.set(symbol, members);
            }
            if (node.isKind(tsm.ts.SyntaxKind.VariableStatement)) {
                for (const decl of node.getDeclarations()) {
                    const symbol = decl.getSymbol()
                    const typeSymbol = decl.getType().getSymbol();
                    if (symbol && typeSymbol) {
                        variables.set(symbol, typeSymbol);
                    }
                }
            }
        });
    }

    context.builtins = { interfaces, variables }
}

function processFunctionsPass(context: CompilationContext): void {
    for (const src of context.project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                const name = node.getName();
                const _export = node.getExportKeyword();
                if (!name) { return; }
                const opCtx: OperationContext = {
                    parent: context,
                    name,
                    isPublic: !!_export,
                    node,
                    builder: new ScriptBuilder(),
                    returnTarget: {}
                };
                if (!context.operations) { context.operations = []; }
                context.operations.push(opCtx);

                const paramCount = node.getParameters().length;
                const localCount = 0;
                if (localCount > 0 || paramCount > 0) {
                    opCtx.builder.push(sc.OpCode.INITSLOT, [localCount, paramCount]);
                }

                const body = node.getBodyOrThrow();
                if (tsm.Node.isStatement(body)) {
                    convertStatement(body, opCtx);
                } else {
                    throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
                }

                opCtx.returnTarget.instruction = opCtx.builder.push(sc.OpCode.RET).instruction;
            }
        })
    }
}

function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
    return input != null;
}

function collectArtifactsPass(context: CompilationContext): void {
    const name = context.name ?? "TestContract";
    const methods = new Array<DebugMethodInfo>();
    let fullScript = Buffer.from([]);

    for (const op of context.operations ?? []) {
        const offset = fullScript.length;
        const { script, sourceReferences } = op.builder.compile(fullScript.length);
        const parameters = op.node.getParameters().map((p, index) => ({
            name: p.getName(),
            index,
            type: toContractType(p.getType()),
        }));
        const returnType = op.node.getReturnType();
        methods.push({
            isPublic: op.isPublic,
            name: op.name,
            range: {
                start: offset,
                end: offset + script.length - 1
            },
            parameters,
            returnType: isVoidLike(returnType)
                ? undefined
                : toContractType(returnType),
            sourceReferences
        })

        fullScript = Buffer.concat([fullScript, script]);
    }

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(fullScript).toString("hex"),
    })

    const manifest = new sc.ContractManifest({
        name: name,
        abi: new sc.ContractAbi({
            methods: methods
                .map(toMethodDef)
                .filter(isNotNullOrUndefined)
        })
    });

    context.artifacts = { nef, manifest, methods }
}

export function convertContractType(type: tsm.Type): sc.ContractParamType;
export function convertContractType(type: ContractType): sc.ContractParamType;
export function convertContractType(type: ContractType | tsm.Type): sc.ContractParamType {
    if (type instanceof tsm.Type) { type = toContractType(type); }
    switch (type.kind) {
        case ContractTypeKind.Array: return sc.ContractParamType.Array;
        case ContractTypeKind.Interop: return sc.ContractParamType.InteropInterface;
        case ContractTypeKind.Map: return sc.ContractParamType.Map;
        case ContractTypeKind.Struct: return sc.ContractParamType.Array;
        case ContractTypeKind.Unspecified: return sc.ContractParamType.Any;
        case ContractTypeKind.Primitive: {
            const primitive = type as PrimitiveContractType;
            switch (primitive.type) {
                case PrimitiveType.Address: return sc.ContractParamType.Hash160;
                case PrimitiveType.Boolean: return sc.ContractParamType.Boolean;
                case PrimitiveType.ByteArray: return sc.ContractParamType.ByteArray;
                case PrimitiveType.Hash160: return sc.ContractParamType.Hash160;
                case PrimitiveType.Hash256: return sc.ContractParamType.Hash256;
                case PrimitiveType.Integer: return sc.ContractParamType.Integer;
                case PrimitiveType.PublicKey: return sc.ContractParamType.PublicKey;
                case PrimitiveType.Signature: return sc.ContractParamType.Signature;
                case PrimitiveType.String: return sc.ContractParamType.String;
                default: throw new Error(`Unrecognized PrimitiveType ${primitive.type}`);
            }
        }
        default: throw new Error(`Unrecognized ContractTypeKind ${type.kind}`);
    }
}

function toMethodDef(
    method: DebugMethodInfo
): sc.ContractMethodDefinition | undefined {
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

function printDiagnostic(diags: tsm.ts.Diagnostic[]) {
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
    artifacts: CompilationArtifacts
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

    const project = new tsm.Project({
        compilerOptions: {
            experimentalDecorators: true,
            target: tsm.ts.ScriptTarget.ES5
        }
    });
    project.createSourceFile(filename, source);
    project.resolveSourceFileDependencies();

    // console.time('getPreEmitDiagnostics');
    const diagnostics = project.getPreEmitDiagnostics();
    // console.timeEnd('getPreEmitDiagnostics')

    if (diagnostics.length > 0) {
        printDiagnostic(diagnostics.map(d => d.compilerObject));
    } else {
        const results = compile({ project });
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

    // const foo = Object.keys(sc.OpCode)
    //     .filter(k => isNaN(Number(k)))
    //     .map(k => `case sc.OpCode.${k}:`);
    // for (const x of foo) { console.log(x); }
    // throw new Error();


    const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

export function symbol() { return "TOKEN"; }
export function decimals() { return 8; }

export function getValue() { 
    return neo.Storage.get(neo.Storage.currentContext, [0x00]); 
}

export function setValue(value: string) { 
    neo.Storage.put(neo.Storage.currentContext, [0x00], value); 
}

export function helloWorld() { return "Hello, World!"; }

export function sayHello(name: string) { return "Hello, " + name + "!"; }
`;

    testCompile(contractSource);
}
