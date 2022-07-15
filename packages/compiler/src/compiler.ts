import { Project, ts } from "ts-morph";
import { CompileContext, CompileResults } from "./types";

// function dumpInstruction(ins: Instruction) {
//     const operand = ins.operand ? Buffer.from(ins.operand).toString('hex') : "";
//     console.log(`  ${sc.OpCode[ins.opCode]} ${operand}`);
// }

// function dumpOperation(op: OperationContext) {

//     const name = op.node.getNameOrThrow();
//     const returnType = convertContractType(tsTypeToContractType(op.node.getReturnType()))
//     console.log(`${name}(): ${sc.ContractParamType[returnType]}`);
//     op.instructions.forEach(dumpInstruction);
// }

// function dumpProject(prj: ProjectContext) {
//     prj.operations.forEach(dumpOperation);
// }

const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

export function getValue() { return neo.getStorage(neo.getCurrentContext(), [0x00]) as string; }
export function setValue(value: string) { neo.putStorage(neo.getCurrentContext(), [0x00], value); }
`;

const project = new Project({
    compilerOptions: {
        experimentalDecorators: true,
        target: ts.ScriptTarget.ES5
    }
});
project.createSourceFile("contract.ts", contractSource);

// console.time('getPreEmitDiagnostics');
var diagnostics = project.getPreEmitDiagnostics();
// console.timeEnd('getPreEmitDiagnostics')

if (diagnostics.length > 0) {
    diagnostics.forEach(d => console.log(d.getMessageText()));
} else {
    compile({ project });
}

function compile(context: CompileContext): Partial<CompileResults> {


    return {};
}




// const prj = convertProject(project);
// dumpProject(prj);

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
