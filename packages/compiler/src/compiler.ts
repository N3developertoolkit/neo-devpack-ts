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

// # Method Start DevHawk.Contracts.ApocToken.GetValue
// # Code Apoc.cs line 20: "{"
// 00 NOP
// # Code Apoc.cs line 21: "return (string)Storage.Get(Storage.CurrentContext, new byte[] { 0x00 });"
// 01 PUSHDATA1 00 # as text: ""
// 04 CONVERT 30 # Buffer type
// 06 CALL_L 1D-00-00-00 # pos: 35 (offset: 29)
// 11 CALL_L 12-00-00-00 # pos: 29 (offset: 18)
// 16 CALL_L 0B-00-00-00 # pos: 27 (offset: 11)
// 21 JMP_L 05-00-00-00 # pos: 26 (offset: 5)
// # Code Apoc.cs line 22: "}"
// 26 RET
// # Method End DevHawk.Contracts.ApocToken.GetValue
// 27 NOP
// 28 RET
// 29 SYSCALL 92-5D-E8-31 # System.Storage.Get SysCall
// 34 RET
// 35 SYSCALL 9B-F6-67-CE # System.Storage.GetContext SysCall
// 40 RET
// # Method Start DevHawk.Contracts.ApocToken.SetValue
// 41 INITSLOT 00-01 # 0 local variables, 1 arguments
// # Code Apoc.cs line 24: "{"
// 44 NOP
// # Code Apoc.cs line 25: "Storage.Put(Storage.CurrentContext, new byte[] { 0x00 }, value);"
// 45 LDARG0
// 46 PUSHDATA1 00 # as text: ""
// 49 CONVERT 30 # Buffer type
// 51 CALL_L F0-FF-FF-FF # pos: 35 (offset: -16)
// 56 CALL_L 06-00-00-00 # pos: 62 (offset: 6)
// # Code Apoc.cs line 26: "}"
// 61 RET
// # Method End DevHawk.Contracts.ApocToken.SetValue
// 62 SYSCALL E6-3F-18-84 # System.Storage.Put SysCall
// 67 RET

const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';

export function getValue() { return neo.Storage.get(neo.Storage.currentContext, [0x00]) as string; }
export function setValue(value: string) { neo.Storage.put(neo.Storage.currentContext, [0x00], value); }
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
