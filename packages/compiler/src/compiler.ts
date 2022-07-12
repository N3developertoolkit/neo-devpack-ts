import { Project, ts } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { Instruction, OperationContext, ProjectContext } from "./models";
import { convertContractType, convertNEF, convertProject, tsTypeToContractType } from "./convert";

function dumpInstruction(ins: Instruction) {
    const operand = ins.operand ? Buffer.from(ins.operand).toString('hex') : "";
    console.log(`  ${sc.OpCode[ins.opCode]} ${operand}`);
}


function dumpOperation(op: OperationContext) {

    const name = op.node.getNameOrThrow();
    const returnType = convertContractType(tsTypeToContractType(op.node.getReturnType()))
    console.log(`${name}(): ${sc.ContractParamType[returnType]}`);
    op.instructions.forEach(dumpInstruction);
}

function dumpProject(prj: ProjectContext) {
    prj.operations.forEach(dumpOperation);
}


// # Method Start DevHawk.Contracts.ApocToken.TotalSupply
// # Code Apoc.cs line 35: "(BigInteger)Storage.Get(Storage.CurrentContext, new byte[] { Prefix_TotalSupply })"
// 0009 PUSHDATA1 00 # as text: ""
// 0012 CONVERT 30 # Buffer type
// 0014 SYSCALL 9B-F6-67-CE # System.Storage.GetContext SysCall
// 0019 SYSCALL 92-5D-E8-31 # System.Storage.Get SysCall
// 0024 DUP
// 0025 ISNULL
// 0026 JMPIFNOT 04 # pos: 30 (offset: 4)
// 0028 DROP
// 0029 PUSH0
// 0030 CONVERT 21 # Integer type
// 0032 RET
// # Method End DevHawk.Contracts.ApocToken.TotalSupply


const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

// export function totalSupply() { return neo.Storage.get(neo.Storage.currentContext, [0x00]) as bigint; }


// export function helloWorld(): string { return "Hello, World!"; }
// export function sayHello(name: string): string { return "Hello, " + name + "!"; }
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
