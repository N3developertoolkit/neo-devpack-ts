import { join } from "path";
import { readFile } from "fs/promises";
import { Project, ts } from "ts-morph";
import { compile, toDiagnostic } from '../packages/compiler/';

async function createContractProject() {
    const project = new Project({
        compilerOptions: {
            experimentalDecorators: true,
            // specify lib file directly to avoid bringing in web apis like DOM and WebWorker
            lib: ["lib.es2020.d.ts"],
            target: ts.ScriptTarget.ES2020,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
        },
        useInMemoryFileSystem: true,
    });

    // load SCFX definitions
    const scfxPath = join(__dirname, "../packages/framework/src/index.d.ts");
    const scfxSource = await readFile(scfxPath, 'utf8');

    await project.getFileSystem().writeFile('/node_modules/@neo-project/neo-contract-framework/index.d.ts', scfxSource);
    return project;
}

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
        } else {
            if (results.artifacts) {
                // dumpArtifacts(results.artifacts);
                // saveArtifacts(artifactPath, filename, source, results.artifacts);
            } else {
                // dumpOperations(results.context.operations);
            }
        }
    } catch (error) {
        printDiagnostics([toDiagnostic(error)]);
    }
}

main();

export enum AnsiEscapeSequences {
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

const green = `${AnsiEscapeSequences.BrightGreen}%s${AnsiEscapeSequences.Reset}`;
const cyan = `${AnsiEscapeSequences.BrightCyan}%s${AnsiEscapeSequences.Reset}`;
const magenta = `${AnsiEscapeSequences.BrightMagenta}%s${AnsiEscapeSequences.Reset}`;
const yellow = `${AnsiEscapeSequences.BrightYellow}%s${AnsiEscapeSequences.Reset}`;

// export function dumpOperations(operations?: ReadonlyArray<OperationInfo>) {
//     for (const op of operations ?? []) {
//         const info = getOperationInfo(op.node);
//         const params = info.parameters.map(p => `${p.name}: ${p.type.getText()}`).join(', ');
//         const publicStr = info.isPublic ? 'public ' : '';
//         const safeStr = info.safe ? ' [safe]' : '';
//         console.log(magenta, `${publicStr}${info.name}(${params})${safeStr}`);

//         const [instructions, references] = separateInstructions(op.instructions);
//         const padding = `${instructions.length}`.length;
//         const findIndex = (ins:Instruction) => { return instructions.findIndex(v => v === ins); }

//         const instructionsLength = instructions.length;
//         for (let i = 0; i < instructionsLength; i++) {
//             const ins = instructions[i];
//             const ref = references.get(i);
//             if (ref) {
//                 console.log(cyan, `# ${ref.print({ removeComments: true })}`);
//             }

//             let msg = util.format(yellow, `${i.toString().padStart(padding)}: `);
//             msg += printOpCode(ins.opCode);
//             if (ins.operand) {
//                 msg += ` ${Buffer.from(ins.operand).toString('hex')}`;
//             }
//             const comment = getComment(ins, findIndex);
//             if (comment) {
//                 msg += util.format(green, ` # ${comment}`);
//             }
            
//             console.log(msg);
//         }
//     }
// }