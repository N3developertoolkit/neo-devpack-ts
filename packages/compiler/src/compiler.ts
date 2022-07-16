import * as tsm from "ts-morph";

// https://github.com/CityOfZion/neon-js/issues/858
const DEFAULT_ADDRESS_VALUE = 53;

export interface CompileOptions {
    project: tsm.Project,
    optimize?: boolean,
    inline?: boolean,
    addressVersion?: number
};

export interface CompilationContext {
    project: tsm.Project,
    options: Required<Omit<CompileOptions, 'project'>>,
    operations: Array<OperationContext>,
    diagnostics: Array<tsm.ts.Diagnostic>
}

export type CompilePass = (context: CompilationContext) => void;

export interface OperationContext {
    name: string,
    node: tsm.FunctionDeclaration
}

export interface CompileResults {
    diagnostics: Array<tsm.ts.Diagnostic>
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
        diagnostics: []
    };

    const passes: Array<CompilePass> = [findFunctionsPass];

    for (const pass of passes) {
        try {
            pass(context);
        } catch (error) {
            const message = error instanceof Error ? error.message : "unknown error";
            context.diagnostics.push(makeDiagnostic(message, tsm.ts.DiagnosticCategory.Error));
        }

        if (context.diagnostics.some(d => d.category == tsm.ts.DiagnosticCategory.Error)) {
            break;
        }
    }

    return {
        diagnostics: context.diagnostics,
    };
}

function findFunctionsPass(context: CompilationContext): void {
    for (const src of context.project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                const name = node.getName();
                if (name) {
                    context.operations.push({ name, node });
                }
            }
        })
    }
}

function makeDiagnostic(
    messageText: string,
    category: tsm.ts.DiagnosticCategory = tsm.ts.DiagnosticCategory.Message
): tsm.ts.Diagnostic {
    return {
        category,
        code: 0,
        file: undefined,
        start: 0,
        length: 0,
        messageText,
    }
}












const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

export function getValue() { 
    return neo.Storage.get(neo.Storage.currentContext, [0x00]); 
}

export function setValue(value: string) { 
    neo.Storage.put(neo.Storage.currentContext, [0x00], value); 
}

function helloWorld() { return "Hello, World!"; }

function sayHello(name: string) { return "Hello, " + name + "!"; }
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

if (diagnostics.length > 0) {
    diagnostics.forEach(d => console.log(d.getMessageText()));
} else {
    const results = compile({ project });
    results.diagnostics?.forEach(d => console.log(d.messageText));
}
