import ts from "typescript";
import { createCompilerHost } from "./createCompilerHost";

function printProgram(program: ts.Program) {
    for (var file of program.getSourceFiles()) {
        if (file.isDeclarationFile) continue;
        printNode(file, 0);
    }
}

function printNode(node: ts.Node, indent: number) {
    console.log(`${new Array(indent + 1).join(' ')}${ts.SyntaxKind[node.kind]}`);
    ts.forEachChild(node, (n: ts.Node) => printNode(n, indent + 1));
}

const contractSource = /*javascript*/`
// import { SmartContract } from '@neo-project/neo-contract-framework';

export class TestContract implements SmartContract {
    public helloWorld() { return "Hello, World!"; }
}`;

const contractFile = ts.createSourceFile("contract.ts", contractSource, ts.ScriptTarget.Latest);
const host = createCompilerHost([contractFile]);
const program = ts.createProgram([contractFile.fileName], {}, host);

const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics && diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
        const message = diagnostic.messageText;
        console.log(message);

        const file = diagnostic.file;
        if (file) {
            let diagPosition = file.fileName;
            const start = diagnostic.start;
            if (start) {
                const lineAndChar = file.getLineAndCharacterOfPosition(start);
                diagPosition += `:${lineAndChar.line + 1}:${lineAndChar.character + 1}`
            }
            console.log(diagPosition);
        }
    }
};

printProgram(program);