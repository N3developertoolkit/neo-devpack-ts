import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
// import { convertStatement } from "./convert";
import { Instruction } from "./types";
import * as path from 'path'

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
    diagnostics?: Array<tsm.ts.Diagnostic>
}

export interface Builtins {
    variables: ReadonlyMap<tsm.Symbol, tsm.Symbol>,
    interfaces: ReadonlyMap<tsm.Symbol, Map<tsm.Symbol, VmCall[]>>,
}

export interface OperationContext {
    parent: CompilationContext,
    name: string,
    node: tsm.FunctionDeclaration,
    instructions: Array<Instruction>
}

export interface StaticField { }

export interface CompileResults {
    diagnostics?: Array<tsm.ts.Diagnostic>,
    context: CompilationContext,
}

function compile(options: CompileOptions): CompileResults {

    const context: CompilationContext = {
        project: options.project,
        options: {
            addressVersion: options.addressVersion ?? DEFAULT_ADDRESS_VALUE,
            inline: options.inline ?? false,
            optimize: options.optimize ?? false,
        },
        operations: [],
        staticFields: [],
        diagnostics: []
    };

    type CompilePass = (context: CompilationContext) => void;
    const passes: Array<CompilePass> = [
        resolveDeclarationsPass,
        findFunctionsPass,
        generateInstructionsPass
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
        context
    };
}

function findFunctionsPass(context: CompilationContext): void {
    for (const src of context.project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                const name = node.getName();
                if (name) {
                    if (!context.operations) { context.operations = []; }
                    context.operations.push({
                        name,
                        node,
                        parent: context,
                        instructions: []
                    });
                }
            }
        })
    }
}

export interface SysCall {
    syscall: string,
}

export type VmCall = SysCall;


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

function generateInstructionsPass(context: CompilationContext): void {
    for (const op of context.operations ?? []) {
        op.instructions.length = 0;
        const paramCount = op.node.getParameters().length;
        const localCount = 0;
        if (localCount > 0 || paramCount > 0) {
            op.instructions.push({
                opCode: sc.OpCode.INITSLOT,
                operand: Uint8Array.from([localCount, paramCount])
            });
        }

        const body = op.node.getBody()
        if (body) {
            if (tsm.Node.isStatement(body)) {
                // convertStatement(body, op);
                op.instructions.push({ opCode: sc.OpCode.RET });
            }
        }
    }
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

function dumpOperations(operations?: OperationContext[]) {
    for (const op of operations ?? []) {
        console.log(op.name);
        for (const ins of op.instructions) {
            const operand = ins.operand
                ? Buffer.from(ins.operand).toString('hex')
                : "";
            console.log(`  ${sc.OpCode[ins.opCode]} ${operand}`)
        }
    }
}

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
        const { diagnostics = [], context } = compile({ project });
        if (diagnostics.length > 0) {
            printDiagnostic(diagnostics);
        } else {
            dumpOperations(context.operations);
        }
    }
}

const file = path.basename(process.argv[1]);
console.log(file);
if (file === "compiler.js") {

    const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

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


