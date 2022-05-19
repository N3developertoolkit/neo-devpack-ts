import ts from "typescript";
import { createCompilerHost } from "./createCompilerHost";

function convert(program: ts.Program) {

    const symbolTable = new SymbolTable(program);
    symbolTable.convert();
}

class SymbolTable {
    private checker: ts.TypeChecker;
    constructor(private program: ts.Program) 
    {
        var rootFileNames = program.getRootFileNames();
        var sourceFiles = program.getSourceFiles();
        this.checker = program.getTypeChecker();
        const foo = this.checker.getAmbientModules();
        console.log();

    }

    

    private isSmartContract(node: ts.ClassLikeDeclaration) {
        for (var clause of node.heritageClauses ?? []) {
            if (clause.token != ts.SyntaxKind.ExtendsKeyword) continue;
            if (clause.types.length != 1) continue;
            
            const foo = this.checker.getTypeAtLocation(clause.types[0])
            const fqn = this.checker.getFullyQualifiedName(foo.symbol);
            console.log();
        }
        return true;
    }

    convert() {


        
        for (var file of this.program.getSourceFiles()) {
            var foo = file.moduleName;
            if (file.isDeclarationFile) continue;

            var s1 = file.statements[0];
            if (ts.isImportDeclaration(s1)) {
                
            }


            

            ts.forEachChild(file, _n => {}, nodes => {
                for (const node of nodes) {
                    if (ts.isClassLike(node) && this.isSmartContract(node)) {
                        console.log(node.name ?? "unknown");
                    }
                }
            });
        }
    }
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
} else {
    convert(program);
}