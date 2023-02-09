import path from "path";
import { ts } from "ts-morph";
import { compile, CompileOptions, createContractProject, hasErrors, toDiagnostic } from '../packages/compiler/';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import { blue, dumpContractMethod } from "./utils";

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

const FILENAME = "sample-contracts/nep17token.ts";
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

            const options: CompileOptions = contractName.startsWith('nep17')
                ? { standards: ["NEP-17"] } : {}
            const { diagnostics, methods, nef, manifest, debugInfo } = compile(project, contractName, options);

            if (diagnostics.length > 0) printDiagnostics(diagnostics);

            if (hasErrors(diagnostics)) return;

            const outputPath = path.join(__dirname, OUTPUT_DIR);
            if ((nef || manifest || debugInfo) && !fs.existsSync(outputPath))
                await fsp.mkdir(outputPath);

            if (nef) {
                const nefPath = path.join(outputPath, `${contractName}.nef`);
                const $nef = Buffer.from(nef.serialize(), 'hex');
                await fsp.writeFile(nefPath, $nef);
                console.log(blue, "Wrote: " + nefPath);
            }

            if (manifest) {
                const manifestPath = path.join(outputPath, `${contractName}.manifest.json`);
                const $manifest = JSON.stringify(manifest.toJson(), null, 4);
                await fsp.writeFile(manifestPath, $manifest);
                console.log(blue, "Wrote: " + manifestPath);
            }

            if (debugInfo) {
                debugInfo["document-root"] = __dirname;
                const debugInfoPath = path.join(outputPath, `${contractName}.debug.json`);
                const $debugInfo = JSON.stringify(debugInfo, null, 4);
                await fsp.writeFile(debugInfoPath, $debugInfo);
                console.log(blue, "Wrote: " + debugInfoPath);
            }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

main();

