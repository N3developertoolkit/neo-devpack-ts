import { Project, ts } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { Instruction, OperationContext, ProjectContext } from "./models";
import { convertProject } from "./convert";

function dumpInstruction(ins: Instruction) {
    const operand = ins.operand ? Buffer.from(ins.operand).toString('hex') : "";
    console.log(`  ${sc.OpCode[ins.opCode]} ${operand}`);
}


function dumpOperation(op: OperationContext) {
    console.log(op.node.getName() ?? "<unknown>");
    op.instructions.forEach(dumpInstruction);
}

function dumpProject(prj: ProjectContext) {
    prj.operations.forEach(dumpOperation);
}




const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

export function decimals() { return 8; }
export function symbol() { return "APOC"; }

export function helloWorld(): string { return "Hello, World!"; }
export function sayHello(name: string): string { return "Hello, " + name + "!"; }
`;

const project = new Project({
    compilerOptions: {
        target: ts.ScriptTarget.ES5
    }
});
project.createSourceFile("contract.ts", contractSource);

// console.time('getPreEmitDiagnostics');
var diagnostics = project.getPreEmitDiagnostics();
// console.timeEnd('getPreEmitDiagnostics')

if (diagnostics.length > 0) {
    diagnostics.forEach(d => console.log(d.getMessageText()));
    process.exit(-1);
}

const prj = convertProject(project);
dumpProject(prj);

// const [nef, manifest] = convertNEF("test-contract", prj);
// const script = Buffer.from(nef.script, 'hex').toString('base64');
// const json = { nef: nef.toJson(), manifest: manifest.toJson(), script }
// console.log(JSON.stringify(json, null, 4));

// const rootPath = path.join(path.dirname(__dirname), "test");
// if (!fs.existsSync(rootPath)) { fs.mkdirSync(rootPath); }
// const nefPath = path.join(rootPath, "contract.nef");
// const manifestPath = path.join(rootPath, "contract.manifest.json");

// fs.writeFileSync(nefPath, Buffer.from(nef.serialize(), 'hex'));
// fs.writeFileSync(manifestPath, JSON.stringify(manifest.toJson(), null, 4));
// console.log(`Contract NEF and Manifest written to ${rootPath}`);
