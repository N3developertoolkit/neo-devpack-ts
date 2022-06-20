import ts from "typescript";
import { Project, InMemoryFileSystemHost } from "ts-morph";

import { createCompilerHost } from "./createCompilerHost";

function processProgram(program: ts.Program) {
    let checker = program.getTypeChecker();

    for (var file of program.getSourceFiles()) {
        if (file.isDeclarationFile) continue;
        // printNode(file);
        ts.forEachChild(file, node => {
            if (ts.isFunctionDeclaration(node)) {
                processFunction(node, checker);
            }
            else if (ts.isClassDeclaration(node)) {
                processClass(node, checker);
            }
        });
    }
}

function processFunction(node: ts.FunctionDeclaration, checker: ts.TypeChecker) {
    if (node.name) {
        console.log(node.name.getText());
    }
}

function processMethod(node: ts.MethodDeclaration, checker: ts.TypeChecker) {
    if (node.name) {
        console.log(node.name.getText());
    }
}

function processClass(node: ts.ClassDeclaration, checker: ts.TypeChecker) {
    if (node.name) {
        console.log(node.name.getText());
    }
    ts.forEachChild(node, node => {
        if (ts.isMethodDeclaration(node)) {
            processMethod(node, checker);
        }
    });
}

function printNode(node: ts.Node, indent: number = 0) {
    console.log(`${new Array(indent + 1).join(' ')}${ts.SyntaxKind[node.kind]}`);
    ts.forEachChild(node, (n: ts.Node) => printNode(n, indent + 1));
}

const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

export class TestContract implements neo.SmartContract {
    public helloWorldMethod() { return "Hello, World!"; }
}

export function helloWorldFunction() { return "Hello, World!"; }
`;

const contractFile = ts.createSourceFile("contract.ts", contractSource, ts.ScriptTarget.ES5);
var host = createCompilerHost([contractFile]);
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

processProgram(program);