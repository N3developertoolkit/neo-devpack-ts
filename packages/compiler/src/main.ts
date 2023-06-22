import { join, basename, isAbsolute } from "path";
import { Node, ts } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { createContractProject, hasErrors, toDiagnostic } from "./utils";
import { CompilerOptions, compile } from "./compiler";
import { ContractMethod } from "./types/CompileOptions";
import { JumpOffsetOperation, Location, Operation, convertTargetOps } from "./types/Operation";
import * as E from 'fp-ts/lib/Either';
import { pipe } from "fp-ts/lib/function";
import { Command, InvalidArgumentError, OptionValues } from 'commander';
import * as fs from 'fs/promises'

const packageJsonVersion = require('../package.json').version;

const program = new Command();
program
    .name('neotsc')
    .description('NEO N3 Smart Contract Compiler for TypeScript')
    .version(packageJsonVersion)
    .argument('<contract-file>', 'TypeScript contract file')
    .option('-o, --output <path>', 'specifies the output directory')
    .option('--base-name <value>', "specifies the base name of the output files")
    .option('--contract-name <value>', "specifies the contract name")
    .option('--standards <values...>', "spectfies the NEP standards to be listed in the manifest")
    .option('--dump-ops', 'dump the compiled contract to the console')
    // TODO: enable these options when optimization and inlining are implemented
    // .option('--no-optimize', "instruct the compiler not to optimize the code")
    // .option('--no-inline', "instruct the compiler not to insert inline code")
    // .option<number>('--address-version <value>', 'indicates the address version used by the compiler', parseAddressVersion, DEFAULT_ADDRESS_VALUE)
    .parse(process.argv);

interface CompilerOptionValues extends OptionValues {
    output?: string;
    baseName?: string;
    contractName?: string;
    standards?: readonly string[];
    dumpOps?: boolean;
    // optimize?: boolean;
    // inline?: boolean;
    // addressVersion?: number;
}

const options = program.opts();
main(program.args, options);

// function parseAddressVersion(value: string, previous: number): number {
//     const parsedValue = parseInt(value, 10);
//     if (isNaN(parsedValue))
//         throw new InvalidArgumentError('Not a number.');
//     return parsedValue;
// }

async function main(args: readonly string[], options: CompilerOptionValues): Promise<void> {

    if (args.length !== 1) {
        throw new InvalidArgumentError('only a single contract file is currently supported');
    }

    const baseName = options.baseName ?? basename(args[0], '.ts');
    let outputFolder = options.output ?? process.cwd();
    if (!isAbsolute(outputFolder)) {
        outputFolder = join(process.cwd(), outputFolder);
    }

    const project = createContractProject();
    for (let arg of args) {
        if (!isAbsolute(arg)) { arg = join(process.cwd(), arg); }
        const source = await fs.readFile(arg, 'utf8');
        project.createSourceFile(arg, source);
    }

    project.resolveSourceFileDependencies();
    const preEmitDiags = project.getPreEmitDiagnostics();
    if (preEmitDiags.length > 0) {
        printDiagnostics(preEmitDiags.map(d => d.compilerObject));
    } else {
        try {
            const compilerOptions: CompilerOptions = {
                baseName,
                contractName: options.contractName,
                standards: options.standards,
            }
            const { diagnostics, compiledProject, nef, manifest, debugInfo } = compile(project, compilerOptions);

            if (diagnostics.length > 0) printDiagnostics(diagnostics);

            if (hasErrors(diagnostics)) return;

            if (compiledProject && options.dumpOps) {
                for (const method of compiledProject.methods) {
                    dumpContractMethod(method);
                }
            }

            if (nef || manifest || debugInfo) {
                await fs.mkdir(outputFolder, { recursive: true });
            }

            if (nef) {
                const nefPath = join(outputFolder, `${baseName}.nef`);
                await fs.writeFile(nefPath, Buffer.from(nef.serialize(), 'hex'));
                console.log(green, "Wrote: " + nefPath);
            }

            if (manifest) {
                const manifestPath = join(outputFolder, `${baseName}.manifest.json`);
                await fs.writeFile(manifestPath, JSON.stringify(manifest.toJson(), null, 4));
                console.log(green, "Wrote: " + manifestPath);
            }

            if (debugInfo) {
                const debugInfoPath = join(outputFolder, `${baseName}.debug.json`);
                // const documents = debugInfo.documents?.map(d => join(REPO_ROOT, d));
                // const jsonDebugInfo = { ...debugInfo, documents };
                await fs.writeFile(debugInfoPath, JSON.stringify(debugInfo, null, 4));
                console.log(green, "Wrote: " + debugInfoPath);
            }
        } catch (error) {
            printDiagnostics([toDiagnostic(error)]);
        }
    }
}

function printDiagnostics(diags: readonly ts.Diagnostic[]) {
    const formatHost: ts.FormatDiagnosticsHost = {
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getNewLine: () => ts.sys.newLine,
        getCanonicalFileName: (fileName: string) => ts.sys.useCaseSensitiveFileNames
            ? fileName : fileName.toLowerCase()
    }

    const msg = ts.formatDiagnosticsWithColorAndContext(diags, formatHost);
    console.log(msg);
}
// const REPO_ROOT = join(__dirname, "../../..");
// const FILENAME = "./sample-contracts/nep11token.ts";
// const OUTPUT_DIR = "./express/out";

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




// function oldmain() {
//     const project = createContractProject();

//     // load test contract
//     const contractName = basename(FILENAME, ".ts");
//     const contractPath = join(REPO_ROOT, FILENAME);
//     const contractSource = readFileSync(contractPath, 'utf8');
//     project.createSourceFile(FILENAME, contractSource);
//     project.resolveSourceFileDependencies();

//     // console.time('getPreEmitDiagnostics');
//     const diagnostics = project.getPreEmitDiagnostics();
//     // console.timeEnd('getPreEmitDiagnostics')

//     if (diagnostics.length > 0) {
//         printDiagnostics(diagnostics.map(d => d.compilerObject));
//     } else {
//         try {

//             const options: Partial<CompileOptions> = contractName.startsWith('nep17')
//                 ? { standards: ["NEP-17"] }
//                 : contractName.startsWith('nep11')
//                     ? { standards: ["NEP-11"] }
//                     : {}
//             const { diagnostics, compiledProject, nef, manifest, debugInfo } = compile(project, contractName, options);

//             if (diagnostics.length > 0) printDiagnostics(diagnostics);

//             if (hasErrors(diagnostics)) return;

//             for (const m of compiledProject?.methods ?? []) {
//                 dumpContractMethod(m);
//             }

//             const outputPath = join(REPO_ROOT, OUTPUT_DIR);
//             if ((nef || manifest || debugInfo) && !existsSync(outputPath))
//                 mkdirSync(outputPath);

//             if (nef) {
//                 const nefPath = join(outputPath, `${contractName}.nef`);
//                 const $nef = Buffer.from(nef.serialize(), 'hex');
//                 writeFileSync(nefPath, $nef);
//                 console.log(green, "Wrote: " + nefPath);
//             }

//             if (manifest) {
//                 const manifestPath = join(outputPath, `${contractName}.manifest.json`);
//                 const $manifest = JSON.stringify(manifest.toJson(), null, 4);
//                 writeFileSync(manifestPath, $manifest);
//                 console.log(green, "Wrote: " + manifestPath);
//             }

//             if (debugInfo) {
//                 const debugInfoPath = join(outputPath, `${contractName}.debug.json`);
//                 const documents = debugInfo.documents?.map(d => join(REPO_ROOT, d));
//                 const jsonDebugInfo = { ...debugInfo, documents };
//                 const $debugInfo = JSON.stringify(jsonDebugInfo, null, 4);
//                 writeFileSync(debugInfoPath, $debugInfo);
//                 console.log(green, "Wrote: " + debugInfoPath);
//             }
//         } catch (error) {
//             printDiagnostics([toDiagnostic(error)]);
//         }
//     }
// }

function dumpContractMethod(method: ContractMethod) {

    const params = method.node.getParameters().map(p => p.getName()).join(", ");
    console.log(magenta, `${method.symbol.getName()}(${params})`);

    pipe(
        method.operations,
        convertTargetOps,
        E.match(
            msg => { throw new Error(msg); },
            operations => {
                return operations.forEach((v, i) => {
                    if (v.location) { console.log(cyan, `  ${dumpLocation(v.location)}`); }
                    console.log(`    ${i}: ${dumpOperation(v, i)}`);
                });
            }
        )
    )
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
            return `${op.kind} ${sc.StackItemType[op.type]}`
        }
        case 'calltoken': {
            return `${op.kind} ${op.token.hash} ${op.token.method}`
        }
        case 'initslot': {
            return `${op.kind} ${op.locals} locals ${op.params} params`
        }
        case 'initstatic': {
            return `${op.kind} ${op.count} static vars`
        }
        case 'call': {
            return `${op.kind} ${op.method.getName()}`
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
            return `${op.kind} ${op.name}`
        }
        case 'loadarg':
        case 'loadlocal':
        case 'loadstatic':
        case 'storearg':
        case 'storelocal':
        case 'storestatic': {
            return `${op.kind} ${op.index}`
        }
        case 'pushbool': {
            return `${op.kind} ${op.value}`;
        }
        case 'pushdata': {
            const buffer = Buffer.from(op.value);
            return `${op.kind} 0x${buffer.toString('hex')} "${buffer.toString('utf8')}"`;
        }
        case 'pushint': {
            return `${op.kind} ${op.value}`
        }
        default:
            return `${op.kind}`
    }
}

