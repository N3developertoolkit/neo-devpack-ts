import ts from "typescript";
import * as path from "path";

export function createCompilerHost(sourceFiles: ts.SourceFile[]): ts.CompilerHost {

    function fileExists(fileName: string) { return ts.sys.fileExists(fileName); }
    function readFile(path: string, encoding?: string | undefined) { return ts.sys.readFile(path, encoding); }

    function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, _onError?: (message: string) => void): ts.SourceFile | undefined {
        for (var sf of sourceFiles) {
            if (fileName === sf.fileName) { return sf; }
        }

        if (!fileExists(fileName))
            return undefined;

        const sourceText = readFile(fileName);
        if (sourceText === undefined)
            return undefined;

        return ts.createSourceFile(fileName, sourceText, languageVersion);
    }

    const defaultLib = path.join(path.dirname(ts.sys.getExecutingFilePath()), "lib.es5.d.ts");
    const fxLib = path.join(__dirname, '../../framework/src/index.d.ts');

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
            _reusedNames: string[] | undefined,
            _redirectedReference: ts.ResolvedProjectReference | undefined,
            options: ts.CompilerOptions,
            _containingSourceFile?: ts.SourceFile
        ): (ts.ResolvedModule | undefined)[] {
            const resolvedModules: ts.ResolvedModule[] = [];
            for (const moduleName of moduleNames) {
                if (moduleName === "@neo-project/neo-contract-framework") {
                    resolvedModules.push({ resolvedFileName: fxLib });
                } else {
                    const result = ts.resolveModuleName(moduleName, containingFile, options, { fileExists, readFile });
                    if (result.resolvedModule) { resolvedModules.push(result.resolvedModule); }
                }
            }
            return resolvedModules;
        }
    };
}
