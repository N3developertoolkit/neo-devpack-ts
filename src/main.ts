import path from "path";
import { ts } from "ts-morph";
import { compile, createContractProject, saveArtifacts, toDiagnostic } from '../packages/compiler/';
// import { dumpArtifacts } from "./utils";
import * as fsp from 'fs/promises';
import * as fs from 'fs';

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

const FILENAME = "sample-contracts/helloworld.ts";
const OUTPUT_DIR = "../express/out";

async function main() {
    const project = await createContractProject();

    // load test contract
    const contractName = path.basename(FILENAME, ".ts");
    const contractPath = path.join(__dirname, FILENAME);
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
            const { diagnostics, nef, manifest, debugInfo } = compile(project, contractName);

            if (diagnostics.length > 0) printDiagnostics(diagnostics);

            const outputPath = path.join(__dirname, OUTPUT_DIR);
            if ((nef || manifest || debugInfo) && !fs.existsSync(outputPath))
                await fsp.mkdir(outputPath);

            if (nef) {
                const nefPath = path.join(outputPath, `${contractName}.nef`);
                const $nef = Buffer.from(nef.serialize(), 'hex');
                await fsp.writeFile(nefPath, $nef);
                console.log(nefPath);
            }

            if (manifest) {
                const manifestPath = path.join(outputPath, `${contractName}.manifest.json`);
                const $manifest = JSON.stringify(manifest.toJson(), null, 4);
                await fsp.writeFile(manifestPath, $manifest);
                console.log(manifestPath);
            }

            if (debugInfo) {
                debugInfo["document-root"] = __dirname;
                const debugInfoPath = path.join(outputPath, `${contractName}.debug.json`);
                const $debugInfo = JSON.stringify(debugInfo, null, 4);
                await fsp.writeFile(debugInfoPath, $debugInfo);
                console.log(debugInfoPath);
            }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

main();

