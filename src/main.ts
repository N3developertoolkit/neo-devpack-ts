import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import { ts } from "ts-morph";
import { compile, createContractProject, saveArtifacts, toDiagnostic } from '../packages/compiler/';
// import { dumpArtifacts } from "./utils";
import * as fsp from 'fs/promises';

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

const FILENAME = "contract-test.ts";
const OUTPUT_DIR = "../express";

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
            const { diagnostics, nef, manifest } = compile({ project });

            if (diagnostics.length > 0) {
                printDiagnostics(diagnostics);
            }

            if (nef) {
                const nefPath = join(__dirname, OUTPUT_DIR, "contract.nef");
                const $nef = Buffer.from(nef.serialize(), 'hex');
                await fsp.writeFile(nefPath, $nef);
            }

            if (manifest) {
                const manifestPath = join(__dirname, OUTPUT_DIR, "contract.manifest.json");
                const $manifest = JSON.stringify(manifest.toJson(), null, 4);
                await fsp.writeFile(manifestPath, $manifest);
            }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

main();

