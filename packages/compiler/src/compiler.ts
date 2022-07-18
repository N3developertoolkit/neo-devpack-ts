import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { convertStatement } from "./convert";
import { Instruction } from "./types";

// https://github.com/CityOfZion/neon-js/issues/858
const DEFAULT_ADDRESS_VALUE = 53;

export class CompileError extends Error { 
    constructor(message: string, public readonly node: tsm.Node ) { 
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
    operations: Array<OperationContext>,
    staticFields: Array<StaticField>,
    diagnostics: Array<tsm.ts.Diagnostic>
}

export interface StaticField { }

export interface OperationContext {
    parent: CompilationContext,
    name: string,
    node: tsm.FunctionDeclaration,
    instructions: Array<Instruction>
}

export interface CompileResults {
    diagnostics: Array<tsm.ts.Diagnostic>,
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
        findFunctionsPass,
        pass2
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

        if (context.diagnostics.some(d => d.category == tsm.ts.DiagnosticCategory.Error)) {
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

function pass2(context: CompilationContext): void {
    for (const op of context.operations) {
        op.instructions = [];
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
                convertStatement(body, op);
            }
        }
    }
}










const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

// export function getValue() { 
//     return neo.Storage.get(neo.Storage.currentContext, [0x00]); 
// }

// export function setValue(value: string) { 
//     neo.Storage.put(neo.Storage.currentContext, [0x00], value); 
// }

export function helloWorld() { return "Hello, World!"; }

export function sayHello(name: string) { return "Hello, " + name + "!"; }
`;

const project = new tsm.Project({
    compilerOptions: {
        experimentalDecorators: true,
        target: tsm.ts.ScriptTarget.ES5
    }
});
project.createSourceFile("contract.ts", contractSource);

// console.time('getPreEmitDiagnostics');
var diagnostics = project.getPreEmitDiagnostics();
// console.timeEnd('getPreEmitDiagnostics')

const formatHost: tsm.ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => tsm.ts.sys.getCurrentDirectory(),
    getNewLine: () => tsm.ts.sys.newLine,
    getCanonicalFileName: (fileName: string) => tsm.ts.sys.useCaseSensitiveFileNames
        ? fileName : fileName.toLowerCase()
}

function printDiagnostic(diags: tsm.ts.Diagnostic[]) {
    const msg = tsm.ts.formatDiagnosticsWithColorAndContext(diags, formatHost);
    console.log(msg);
}

if (diagnostics.length > 0) {
    printDiagnostic(diagnostics.map(d => d.compilerObject));
} else {
    const files = project.getSourceFiles();
    const results = compile({ project });
    if (results.diagnostics.length > 0) {
        printDiagnostic(results.diagnostics);
    } else {
        for (const op of results.context.operations) {
            console.log(op.name);
            for (const ins of op.instructions) {
                const operand = ins.operand
                    ? Buffer.from(ins.operand).toString('hex')
                    : "";
                console.log(`  ${sc.OpCode[ins.opCode]} ${operand}`)
            }
        }
    }
}
