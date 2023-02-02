import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import { ts } from "ts-morph";
import { compile, createContractProject, saveArtifacts, toDiagnostic } from '../packages/compiler/';
// import { dumpArtifacts } from "./utils";

const FILENAME = "contract-test.ts";

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
    const contractSource = await readFile(join(__dirname, FILENAME), 'utf8');
    project.createSourceFile(FILENAME, contractSource);
    project.resolveSourceFileDependencies();

    // console.time('getPreEmitDiagnostics');
    const diagnostics = project.getPreEmitDiagnostics();
    // console.timeEnd('getPreEmitDiagnostics')

    if (diagnostics.length > 0) {
        printDiagnostics(diagnostics.map(d => d.compilerObject));
    } else {
        try {
            // const { artifacts, context, diagnostics } = 
            const { diagnostics } = compile({ project });

            if (diagnostics.length > 0) {
                printDiagnostics(diagnostics);
                return;
            }
            // if (artifacts) {
            //     dumpArtifacts(artifacts);
            //     const rootPath = join(__dirname, "../express/out");
            //     const sourceDir = join(rootPath, "..");
            //     await saveArtifacts({
            //         artifacts,
            //         rootPath,
            //         sourceDir,
            //     })

            //     await writeFile(join(sourceDir, "contract.ts"), contractSource)

            // } else {
            //     for (const func of context.functions) {
            //         dumpFunctionContext(func);
            //     }
            // }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

main();

