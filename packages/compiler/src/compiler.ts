import ts from "typescript";
import { createCompilerHost } from "./createCompilerHost";

const mockFileContents = /*javascript*/`
import { SmartContract } from '@neo-project/neo-contract-framework';

export class TestContract extends SmartContract {

    public helloWorld() { return "Hello, World!"; }

}`;

const mockSourceFile = ts.createSourceFile("contract.ts", mockFileContents, ts.ScriptTarget.Latest);
const program = ts.createProgram([mockSourceFile.fileName], {}, createCompilerHost([mockSourceFile]));

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
} else {
    
    for (var file of program.getSourceFiles()) {
        if (file.isDeclarationFile) { continue; }
        ts.forEachChild(file, n => {
            console.log(ts.SyntaxKind[n.kind]);
        })
    }
}