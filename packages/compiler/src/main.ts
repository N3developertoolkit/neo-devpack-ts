import * as path from "path";
import { compile, CompileOptions, createContractProject, hasErrors, toDiagnostic } from './index'
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import { ts } from "ts-morph";

const REPO_ROOT = path.join(__dirname, "../../..");
const FILENAME = "./sample-contracts/helloworld.ts";
const OUTPUT_DIR = "./express/out";

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
    const contractName = path.basename(FILENAME, ".ts");
    const contractPath = path.join(REPO_ROOT, FILENAME);
    const contractSource = await fsp.readFile(contractPath, 'utf8');
    project.createSourceFile(FILENAME, contractSource);
    project.resolveSourceFileDependencies();

    // console.time('getPreEmitDiagnostics');
    const diagnostics = project.getPreEmitDiagnostics();
    // console.timeEnd('getPreEmitDiagnostics')

    if (diagnostics.length > 0) {
        printDiagnostics(diagnostics.map(d => d.compilerObject));
    } else {
        try {

            const options: Partial<CompileOptions> = contractName.startsWith('nep17')
                ? { standards: ["NEP-17"] } 
                : {}
            const { diagnostics, nef, manifest, debugInfo } = compile(project, contractName, options);

            if (diagnostics.length > 0) printDiagnostics(diagnostics);

            if (hasErrors(diagnostics)) return;

            const outputPath = path.join(REPO_ROOT, OUTPUT_DIR);
            if ((nef || manifest || debugInfo) && !fs.existsSync(outputPath))
                await fsp.mkdir(outputPath);

            if (nef) {
                const nefPath = path.join(outputPath, `${contractName}.nef`);
                const $nef = Buffer.from(nef.serialize(), 'hex');
                await fsp.writeFile(nefPath, $nef);
                console.log("Wrote: " + nefPath);
            }

            if (manifest) {
                const manifestPath = path.join(outputPath, `${contractName}.manifest.json`);
                const $manifest = JSON.stringify(manifest.toJson(), null, 4);
                await fsp.writeFile(manifestPath, $manifest);
                console.log("Wrote: " + manifestPath);
            }

            if (debugInfo) {
                const debugInfoPath = path.join(outputPath, `${contractName}.debug.json`);
                const jsonDebugInfo = debugInfo.toJson();
                jsonDebugInfo["document-root"] = REPO_ROOT;
                const $debugInfo = JSON.stringify(jsonDebugInfo, null, 4);
                await fsp.writeFile(debugInfoPath, $debugInfo);
                console.log("Wrote: " + debugInfoPath);
            }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

main();
