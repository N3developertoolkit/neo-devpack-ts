import * as ts from "typescript";
import * as path from "path";
import { rmSync } from "fs";

function createCompilerHost(sourceFiles: ts.SourceFile[]): ts.CompilerHost {

    function fileExists(fileName: string) { return ts.sys.fileExists(fileName); }
    function readFile(path: string, encoding?: string | undefined) { return ts.sys.readFile(path, encoding); }

    function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void): ts.SourceFile | undefined {
        for (var sf of sourceFiles) {
            if (fileName === sf.fileName) { return sf; }
        }

        if (!fileExists(fileName)) return undefined;

        const sourceText = readFile(fileName);
        if (sourceText === undefined) return undefined;

        return ts.createSourceFile(fileName, sourceText, languageVersion);
    }

    const defaultLib = path.join(path.dirname(ts.sys.getExecutingFilePath()), "lib.es5.d.ts");

    return {
        getSourceFile,
        getDefaultLibFileName: () => defaultLib,
        getCanonicalFileName: fileName => ts.sys.useCaseSensitiveFileNames
            ? fileName
            : fileName.toLowerCase(),
        fileExists,
        readFile,
        writeFile: (path: string, data: string, writeByteOrderMark?: boolean | undefined) => ts.sys.writeFile(path, data, writeByteOrderMark),
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getDirectories: path => ts.sys.getDirectories(path),
        getNewLine: () => ts.sys.newLine,
        useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
        resolveModuleNames(
            moduleNames: string[],
            containingFile: string,
            reusedNames: string[] | undefined,
            redirectedReference: ts.ResolvedProjectReference | undefined,
            options: ts.CompilerOptions,
            containingSourceFile?: ts.SourceFile
        ): (ts.ResolvedModule | undefined)[] {
            const scfxpath = 'C:/Users/harry/Source/neo/seattle/compiler-ts/packages/framework/src/framework.d.ts';
            const resolvedModules: ts.ResolvedModule[] = [];
            for (const moduleName of moduleNames) {
                if (moduleName === "@neo-project/neo-contract-framework") {
                    resolvedModules.push({ resolvedFileName: scfxpath });
                } else {
                    const result = ts.resolveModuleName(moduleName, containingFile, options, { fileExists, readFile });
                    if (result.resolvedModule) { resolvedModules.push(result.resolvedModule); }
                }
            }
            return resolvedModules;
        }
    }
}

const mockFileContents = `
import { SmartContract } from '@neo-project/neo-contract-framework';

export class Token extends SmartContract {}
`;
const mockSourceFile = ts.createSourceFile("contract.ts", mockFileContents, ts.ScriptTarget.Latest);
const program = ts.createProgram([mockSourceFile.fileName], {}, createCompilerHost([mockSourceFile]));

const diagnostics = ts.getPreEmitDiagnostics(program);

function visit(node: ts.Node) {
    
    console.log(ts.SyntaxKind[node.kind]);

    ts.forEachChild(node, visit);
}

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
    for (const sourceFile of program.getSourceFiles()) {
        if (!sourceFile.isDeclarationFile) {
            visit(sourceFile);
        }
    }
}