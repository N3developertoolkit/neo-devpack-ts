import { ClassDeclaration, FunctionDeclaration, Node, Project, SyntaxKind, ts, VariableDeclaration } from "ts-morph";
import * as c from "./common";

function processProject(project: Project) {
    var globalScope = new c.GlobalScope();
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(n => {
            if (Node.isImportDeclaration(n)) {
                // skip import declarations for now
            } else if (n.getKind() == SyntaxKind.EndOfFileToken) {
                // ignore EndOfFileToken
            } else if (Node.isClassDeclaration(n)) {
                processClass(n, globalScope);
            } else if (Node.isFunctionDeclaration(n)) {
                processFunction(n, globalScope);
            } else if (Node.isVariableDeclaration(n)) {
                processVariable(n, globalScope);
            } else {
                throw new Error(`${n.getKindName()} not implemented.`);
            }
        })
    }
    return globalScope;
}

function processFunction(decl: FunctionDeclaration, scope: c.Scope) {
    const symbol = scope.define(s => new c.FunctionScope(decl, s));
}

function processVariable(decl: VariableDeclaration, scope: c.Scope) {
    const symbol = scope.define(s => new c.VariableSymbol(decl, s));
}

function processClass(decl: ClassDeclaration, scope: c.Scope) {
    const symbol = scope.define(s => new c.ClassScope(decl, s));
}

const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

// test me

const result = 42;
function nonExported() { return result; }

export function helloWorld() { return "Hello, World!"; }

export class TestContract extends SmartContract {}
`;

const project = new Project();
project.createSourceFile("contract.ts", contractSource);

var diagnostics = project.getPreEmitDiagnostics();
if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
        const message = diagnostic.getMessageText();
        console.log(message);

        const file = diagnostic.getSourceFile();
        if (!file) continue;
        let diagPosition = file.getBaseName();
        const start = diagnostic.getStart()
        if (!start) continue;
        const lineAndChar = file.getLineAndColumnAtPos(start);
        diagPosition += `:${lineAndChar.line + 1}:${lineAndChar.column + 1}`
        console.log(diagPosition);
    }
};

var gs = processProject(project);
console.log();
