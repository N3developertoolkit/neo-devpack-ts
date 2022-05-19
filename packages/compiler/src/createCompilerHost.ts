import ts from "typescript";
import * as path from "path";

export function createCompilerHost(sourceFiles: ts.SourceFile[]): ts.CompilerHost {

    const defaultLibFileName = 'neo.scfx.d.ts';
    const defaultLibLocation = path.join(__dirname, '../../framework/src', defaultLibFileName);
    
    function realpath(fileName: string): string {
        const base = path.basename(fileName);
        const tsdir = path.basename(path.dirname(fileName));
        const nodeModDir = path.basename(path.dirname(path.dirname(fileName)));
        if (nodeModDir === "node_modules" && tsdir === '@typescript' 
            && base.startsWith('lib-') && base.endsWith(".d.ts")
        ) {
            const newPath = path.join(path.dirname(ts.sys.getExecutingFilePath()), base.replace('-', '.'));
            return newPath;
        }
        return fileName;
    }

    function fileExists(fileName: string) { 
        return ts.sys.fileExists(realpath(fileName)); 
    }
    function readFile(path: string, encoding?: string | undefined) { 
        return ts.sys.readFile(realpath(path), encoding); 
    }

    function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, _onError?: (message: string) => void): ts.SourceFile | undefined {
        for (var sf of sourceFiles) {
            if (fileName === sf.fileName) { return sf; }
        }

        if (fileName === defaultLibFileName) {
            const source = ts.sys.readFile(defaultLibLocation);
            return (source) ? ts.createSourceFile(fileName, source, languageVersion) : undefined;
        }

        if (ts.sys.fileExists(fileName)) {
            const source = ts.sys.readFile(fileName);
            return (source) ? ts.createSourceFile(fileName, source, languageVersion) : undefined;
        }

        return undefined;

        // if (!fileExists(fileName))
        //     return undefined;

        // const sourceText = readFile(fileName);
        // if (sourceText === undefined)
        //     return undefined;

        // return ts.createSourceFile(fileName, sourceText, languageVersion);
    }

    function getSourceFileByPath(fileName: string, path: ts.Path, languageVersion: ts.ScriptTarget, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined {
        return undefined;
    }


    function resolveModuleNames(moduleNames: string[], containingFile: string, reusedNames: string[] | undefined, redirectedReference: ts.ResolvedProjectReference | undefined, options: ts.CompilerOptions, containingSourceFile?: ts.SourceFile): (ts.ResolvedModule | undefined)[] {
        return [];
    }

    function resolveTypeReferenceDirectives(typeReferenceDirectiveNames: string[], containingFile: string, redirectedReference: ts.ResolvedProjectReference | undefined, options: ts.CompilerOptions): (ts.ResolvedTypeReferenceDirective | undefined)[] {
        return [];
    }



    
    return {
        getSourceFile,
        getSourceFileByPath,
        getDefaultLibFileName: (options: ts.CompilerOptions) => defaultLibFileName,
        getDefaultLibLocation: () => defaultLibLocation,


        getCanonicalFileName: fileName => ts.sys.useCaseSensitiveFileNames
            ? fileName
            : fileName.toLowerCase(),
        fileExists,
        readFile,
        writeFile: (path: string, data: string) => { throw new Error(); },
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getDirectories: path => ts.sys.getDirectories(path),
        getNewLine: () => ts.sys.newLine,
        useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
        resolveModuleNames,
        resolveTypeReferenceDirectives,
        realpath,
    };
}
