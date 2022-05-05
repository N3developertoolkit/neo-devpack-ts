import * as ts from "typescript";
import * as path from "path";

function createCompilerHost(sourceFiles: ts.SourceFile[]): ts.CompilerHost {
    
    function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void) {
        for (var sf of sourceFiles) {
            if (fileName === sf.fileName) { return sf; }
        }

        if (!ts.sys.fileExists(fileName)) return undefined;

        const sourceText = ts.sys.readFile(fileName);
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
        fileExists: fileName => ts.sys.fileExists(fileName),
        readFile: (path: string, encoding?: string | undefined) => ts.sys.readFile(path, encoding),
        writeFile: (path: string, data: string, writeByteOrderMark?: boolean | undefined) => ts.sys.writeFile(path, data, writeByteOrderMark),
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getDirectories: path => ts.sys.getDirectories(path),
        getNewLine: () => ts.sys.newLine,
        useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    }
}

const mockFileContents = `const test: number = 1 + 2;`;

const mockSourceFile = ts.createSourceFile(
    "Test.ts", mockFileContents, ts.ScriptTarget.Latest
);

const program = ts.createProgram(
    [mockSourceFile.fileName], {}, createCompilerHost([mockSourceFile])
);

const diagnostics = ts.getPreEmitDiagnostics(program);

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