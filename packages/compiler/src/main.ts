import { join, basename } from "path";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { Node, ts } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { createContractProject, hasErrors, toDiagnostic } from "./utils";
import { compile } from "./compiler";
import { CompileOptions, ContractMethod } from "./types/CompileOptions";
import { CallOperation, CallTokenOperation, ConvertOperation, InitSlotOperation, JumpOffsetOperation, LoadStoreOperation, Location, Operation, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation } from "./types/Operation";

const REPO_ROOT = join(__dirname, "../../..");
const FILENAME = "./sample-contracts/nep17token.ts";
const OUTPUT_DIR = "./express/out";

enum AnsiEscapeSequences {
    Black = "\u001b[30m",
    Red = "\u001b[31m",
    Green = "\u001b[32m",
    Yellow = "\u001b[33m",
    Blue = "\u001b[34m",
    Magenta = "\u001b[35m",
    Cyan = "\u001b[36m",
    White = "\u001b[37m",
    Gray = "\u001b[90m",
    BrightRed = "\u001b[91m",
    BrightGreen = "\u001b[92m",
    BrightYellow = "\u001b[93m",
    BrightBlue = "\u001b[94m",
    BrightMagenta = "\u001b[95m",
    BrightCyan = "\u001b[96m",
    BrightWhite = "\u001b[97m",
    Invert = "\u001b[7m",
    Reset = "\u001b[0m",
}

export const green = `${AnsiEscapeSequences.BrightGreen}%s${AnsiEscapeSequences.Reset}`;
export const cyan = `${AnsiEscapeSequences.BrightCyan}%s${AnsiEscapeSequences.Reset}`;
export const magenta = `${AnsiEscapeSequences.BrightMagenta}%s${AnsiEscapeSequences.Reset}`;
export const yellow = `${AnsiEscapeSequences.BrightYellow}%s${AnsiEscapeSequences.Reset}`;
export const blue = `${AnsiEscapeSequences.BrightBlue}%s${AnsiEscapeSequences.Reset}`;
export const invert = `${AnsiEscapeSequences.Invert}%s${AnsiEscapeSequences.Reset}`;

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

function main() {
    const project = createContractProject();

    // load test contract
    const contractName = basename(FILENAME, ".ts");
    const contractPath = join(REPO_ROOT, FILENAME);
    const contractSource = readFileSync(contractPath, 'utf8');
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
                : contractName.startsWith('nep11')
                    ? { standards: ["NEP-11"] }
                    : {}
            const { diagnostics, compiledProject, nef, manifest, debugInfo } = compile(project, contractName, options);

            if (diagnostics.length > 0) printDiagnostics(diagnostics);

            if (hasErrors(diagnostics)) return;

            for (const m of compiledProject?.methods ?? []) {
                dumpContractMethod(m);
            }

            const outputPath = join(REPO_ROOT, OUTPUT_DIR);
            if ((nef || manifest || debugInfo) && !existsSync(outputPath))
                mkdirSync(outputPath);

            if (nef) {
                const nefPath = join(outputPath, `${contractName}.nef`);
                const $nef = Buffer.from(nef.serialize(), 'hex');
                writeFileSync(nefPath, $nef);
                console.log(green, "Wrote: " + nefPath);
            }

            if (manifest) {
                const manifestPath = join(outputPath, `${contractName}.manifest.json`);
                const $manifest = JSON.stringify(manifest.toJson(), null, 4);
                writeFileSync(manifestPath, $manifest);
                console.log(green, "Wrote: " + manifestPath);
            }

            if (debugInfo) {
                const debugInfoPath = join(outputPath, `${contractName}.debug.json`);
                const jsonDebugInfo = debugInfo.toJson();
                jsonDebugInfo.documents = jsonDebugInfo.documents?.map(d => join(REPO_ROOT, d));
                const $debugInfo = JSON.stringify(jsonDebugInfo, null, 4);
                writeFileSync(debugInfoPath, $debugInfo);
                console.log(green, "Wrote: " + debugInfoPath);
            }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

main();


function dumpContractMethod(method: ContractMethod) {

    const params = method.node.getParameters().map(p => p.getName()).join(", ");
    console.log(magenta, `${method.symbol.getName()}(${params})`);
    method.operations.forEach((v, i) => {
        if (v.location) { console.log(cyan, `  ${dumpLocation(v.location)}`); }
        console.log(`    ${i}: ${dumpOperation(v, i)}`);
    })
}
function dumpLocation(location: Location) {
    if (Node.isNode(location)) {
        return location.print();
    } else {
        const src = location.start.getSourceFile().getFullText();
        const start = location.start.getStart();
        const end = location.end.getEnd();
        return src.substring(start, end);
    }
}

function dumpOperation(op: Operation, currentIndex: number) {
    switch (op.kind) {
        case 'convert': {
            const { type } = op as ConvertOperation;
            return `${op.kind} ${sc.StackItemType[type]}`
        }
        case 'calltoken': {
            const { token } = op as CallTokenOperation;
            return `${op.kind} ${token.hash} ${token.method}`
        }
        case 'initslot': {
            const { locals, params } = op as InitSlotOperation;
            return `${op.kind} ${locals} locals ${params} params`
        }
        case 'call': {
            const { method } = op as CallOperation;
            return `${op.kind} ${method.getName()}`
        }
        case 'jump':
        case 'jumpif':
        case 'jumpifnot':
        case 'jumpeq':
        case "jumpne":
        case "jumpgt":
        case "jumpge":
        case "jumplt":
        case "jumple": {
            const { offset } = op as JumpOffsetOperation;
            return `${op.kind} ${offset} (${offset + currentIndex})`
        }
        case 'syscall': {
            const { name } = op as SysCallOperation;
            return `${op.kind} ${name}`
        }
        case 'loadarg':
        case 'loadlocal':
        case 'loadstatic':
        case 'storearg':
        case 'storelocal':
        case 'storestatic': {
            const { index } = op as LoadStoreOperation
            return `${op.kind} ${index}`
        }
        case 'pushbool': {
            const { value } = op as PushBoolOperation;
            return `${op.kind} ${value}`;
        }
        case 'pushdata': {
            const { value } = op as PushDataOperation;
            const buffer = Buffer.from(value);
            return `${op.kind} 0x${buffer.toString('hex')} "${buffer.toString('utf8')}"`;
        }
        case 'pushint': {
            const { value } = op as PushIntOperation;
            return `${op.kind} ${value}`
        }
        default:
            return `${op.kind}`
    }
}

