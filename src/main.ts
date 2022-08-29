import { join } from "path";
import { readFile } from "fs/promises";
import { ts } from "ts-morph";
import { compile, createContractProject, saveArtifacts, toDiagnostic } from '../packages/compiler/';
import { dumpArtifacts, dumpFunctionContext } from "./utils";

function printDiagnostics(diags: ReadonlyArray<ts.Diagnostic>) {
    const formatHost: ts.FormatDiagnosticsHost = {
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getNewLine: () => ts.sys.newLine,
        getCanonicalFileName: (fileName: string) => ts.sys.useCaseSensitiveFileNames
            ? fileName : fileName.toLowerCase()
    }

    const msg = ts.formatDiagnosticsWithColorAndContext(diags, formatHost);
    console.log(msg);
}

async function main() {
    const project = await createContractProject();

    // load test contract
    const contractPath = join(__dirname, "contract.ts");
    const contractSource = await readFile(contractPath, 'utf8');

    project.createSourceFile("contract.ts", contractSource);
    project.resolveSourceFileDependencies();

    // console.time('getPreEmitDiagnostics');
    const diagnostics = project.getPreEmitDiagnostics();
    // console.timeEnd('getPreEmitDiagnostics')

    if (diagnostics.length > 0) {
        printDiagnostics(diagnostics.map(d => d.compilerObject));
        return;
    }

    try {
        const results = compile({ project });
        if (results.diagnostics.length > 0) {
            printDiagnostics(results.diagnostics);
            return;
        }

        if (results.artifacts) {
            dumpArtifacts(results.artifacts);
            await saveArtifacts(results.artifacts, join(__dirname, "../express/out"))
        } else {
            for (const func of results.context.functions) {
                dumpFunctionContext(func);
            }
        }
    } catch (error) {
        printDiagnostics([toDiagnostic(error)]);
    }
}

main();

