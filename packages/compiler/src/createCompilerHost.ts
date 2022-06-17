import * as ts from "typescript";

const defaultLibFileContents = /*javascript*/`
/// <reference no-default-lib="true"/>
/// <reference lib="es5" />
`

export function createCompilerHost(sourceFiles: ts.SourceFile[]): ts.CompilerHost {
    var rootHost = ts.createCompilerHost({});
    const defaultLibFileName = rootHost.getDefaultLibFileName({});

    return {
        fileExists(fileName) {
            const ret = rootHost.fileExists(fileName);
            return ret;
        },
        getCanonicalFileName(fileName) {
            const ret =  rootHost.getCanonicalFileName(fileName);
            return ret;
        },
        getCurrentDirectory() {
            const ret = rootHost.getCurrentDirectory();
            return ret;
        },
        getDefaultLibFileName(options) {
            const ret = defaultLibFileName;
            return ret;
        },
        getNewLine() {
            const ret = rootHost.getNewLine();
            return ret;
        },
        getSourceFile(fileName, languageVersion, onError?, shouldCreateNewSourceFile?) {
            for (var sf of sourceFiles) {
                if (fileName === sf.fileName) { 
                    return sf; 
                }
            }
            if (fileName === defaultLibFileName) {
                return ts.createSourceFile(fileName, defaultLibFileContents, languageVersion);
            }
            const ret = rootHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
            return ret;
        },
        readFile(fileName) {
            const ret = rootHost.readFile(fileName);
            return ret;
        },
        useCaseSensitiveFileNames() {
            const ret = rootHost.useCaseSensitiveFileNames();
            return ret;
        },
        writeFile(fileName, data, writeByteOrderMark, onError?, sourceFiles?) {
            const ret = rootHost.writeFile(fileName, data, writeByteOrderMark, onError, sourceFiles);
            return ret;
        }
    }
}
