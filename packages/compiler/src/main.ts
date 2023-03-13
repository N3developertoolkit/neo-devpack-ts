import * as path from "path";
import { CallOperation, CallTokenOperation, compile, CompileOptions, ContractMethod, ConvertOperation, createContractProject, hasErrors, InitSlotOperation, JumpOffsetOperation, LoadStoreOperation, Location, Operation, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation, toDiagnostic } from './index'
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import { Node, ts } from "ts-morph";
import { sc } from "@cityofzion/neon-core";

const REPO_ROOT = path.join(__dirname, "../../..");
const FILENAME = "./sample-contracts/nep17token.ts";
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
            const { diagnostics, methods, nef, manifest, debugInfo } = compile(project, contractName, options);

            if (diagnostics.length > 0) printDiagnostics(diagnostics);

            if (hasErrors(diagnostics)) return;

            for (const m of methods ?? []) {
                dumpContractMethod(m);
            }

            const outputPath = path.join(REPO_ROOT, OUTPUT_DIR);
            if ((nef || manifest || debugInfo) && !fs.existsSync(outputPath))
                await fsp.mkdir(outputPath);

            if (nef) {
                const nefPath = path.join(outputPath, `${contractName}.nef`);
                const $nef = Buffer.from(nef.serialize(), 'hex');
                await fsp.writeFile(nefPath, $nef);
                console.log(green, "Wrote: " + nefPath);
            }

            if (manifest) {
                const manifestPath = path.join(outputPath, `${contractName}.manifest.json`);
                const $manifest = JSON.stringify(manifest.toJson(), null, 4);
                await fsp.writeFile(manifestPath, $manifest);
                console.log(green, "Wrote: " + manifestPath);
            }

            if (debugInfo) {
                const debugInfoPath = path.join(outputPath, `${contractName}.debug.json`);
                const jsonDebugInfo = debugInfo.toJson();
                jsonDebugInfo.documents = jsonDebugInfo.documents?.map(d => path.join(REPO_ROOT, d));
                const $debugInfo = JSON.stringify(jsonDebugInfo, null, 4);
                await fsp.writeFile(debugInfoPath, $debugInfo);
                console.log(green, "Wrote: " + debugInfoPath);
            }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

main();


function dumpContractMethod(method: ContractMethod) {
    console.log(magenta, method.symbol.getName());
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
        case 'syscall':{
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