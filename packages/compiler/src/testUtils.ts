// import * as tsm from "ts-morph";
// import { OperationInfo } from "./types/CompileContext";
// import { Instruction, isCallInstruction, isJumpInstruction, isTryInstruction, JumpTarget } from "./types/Instruction";
// import { OpCode, toString as printOpCode } from "./types/OpCode";
// import { separateInstructions, sysCallHash } from "./types/OperationBuilder";
// import { toString as printStackItemType } from "./types/StackItem";
// import * as util from 'util';
// import { getOperationInfo } from "./passes/processOperations";

import path from 'path';
import fs from 'fs/promises';
import { AsyncLazy } from './utility/Lazy';
import { createContractProject } from './utils';
import { CompileContext, DEFAULT_ADDRESS_VALUE } from './compiler';
import { createGlobalScope } from './scope';

const scfx = new AsyncLazy(async () => {
    const scfxPath = path.join(__dirname, "../../framework/src/index.d.ts");
    return await fs.readFile(scfxPath, 'utf8');
})

export async function createTestProject(source: string) {
    const scfxSrc = await scfx.get();
    const project = await createContractProject(scfxSrc);
    const sourceFile = project.createSourceFile("contract.ts", source);
    project.resolveSourceFileDependencies();
    return { project, sourceFile };
}



// export enum AnsiEscapeSequences {
//     Black = "\u001b[30m",
//     Red = "\u001b[31m",
//     Green = "\u001b[32m",
//     Yellow = "\u001b[33m",
//     Blue = "\u001b[34m",
//     Magenta = "\u001b[35m",
//     Cyan = "\u001b[36m",
//     White = "\u001b[37m",
//     Gray = "\u001b[90m",
//     BrightRed = "\u001b[91m",
//     BrightGreen = "\u001b[92m",
//     BrightYellow = "\u001b[93m",
//     BrightBlue = "\u001b[94m",
//     BrightMagenta = "\u001b[95m",
//     BrightCyan = "\u001b[96m",
//     BrightWhite = "\u001b[97m",
//     Invert = "\u001b[7m",
//     Reset = "\u001b[0m",
// }

// const green = `${AnsiEscapeSequences.BrightGreen}%s${AnsiEscapeSequences.Reset}`;
// const cyan = `${AnsiEscapeSequences.BrightCyan}%s${AnsiEscapeSequences.Reset}`;
// const magenta = `${AnsiEscapeSequences.BrightMagenta}%s${AnsiEscapeSequences.Reset}`;
// const yellow = `${AnsiEscapeSequences.BrightYellow}%s${AnsiEscapeSequences.Reset}`;

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

// // // export function dumpArtifacts({ nef, methods }: Immutable<CompileArtifacts>) {

// // //     const starts = new Map(methods.map(m => [m.range.start, m]));
// // //     const ends = new Map(methods.map(m => [m.range.end, m]));
// // //     const points = new Map<number, tsm.Node>();
// // //     for (const m of methods) {
// // //         for (const [address, node] of m.sequencePoints) {
// // //             points.set(address, node);
// // //         }
// // //     }

// // //     const opTokens = sc.OpToken.fromScript(nef.script);
// // //     let address = 0;
// // //     for (const token of opTokens) {
// // //         const size = token.toScript().length / 2;
// // //         address += size;
// // //     }

// // //     const padding = `${address}`.length;


// // //     address = 0;
// // //     for (const token of opTokens) {
// // //         const s = starts.get(address);
// // //         if (s) { console.log(magenta, `# Method Start ${s.name}`); }

// // //         const n = points.get(address);
// // //         if (n) { console.log(cyan, `# ${n.print()}`); }

// // //         let msg = `${address.toString().padStart(padding)}: ${token.prettyPrint()}`;
// // //         // const comment = getComment(token, address);
// // //         // if (comment)
// // //         //     msg += util.format(green, ` # ${comment}`);
// // //         console.log(msg);

// // //         const e = ends.get(address);
// // //         if (e) { console.log(magenta, `# Method End ${e.name}`); }

// // //         const size = token.toScript().length / 2;
// // //         address += size;
// // //     }
// // // }

// export function getComment(ins: Instruction, findIndex: (ins: Instruction) => number): string | undefined {

//     function resolveTarget(target: JumpTarget) {
//         if (!target.instruction) { return "offset target not set"; }
//         const index = findIndex(target.instruction);
//         return index < 0 ? "offset target not found" : `offset target ${index}`;
//     }

//     if (isJumpInstruction(ins)) { 
//         return resolveTarget(ins.target); 
//     }
//     if (isCallInstruction(ins)) {
//         return `call ${ins.operation.node.getNameOrThrow()}`;
//     }
//     if (isTryInstruction(ins)) {
//         const catchResolved = resolveTarget(ins.catchTarget);
//         const finallyResolved = resolveTarget(ins.finallyTarget);
//         return `catch ${catchResolved}, finally ${finallyResolved}`;
//     }

//     switch (ins.opCode) {
//         case OpCode.PUSHINT8:
//         case OpCode.PUSHINT16:
//         case OpCode.PUSHINT32:
//         case OpCode.PUSHINT64:
//         case OpCode.PUSHINT128:
//         case OpCode.PUSHINT256: {
//             let hex = Buffer.from(ins.operand!).reverse().toString('hex');
//             return `${BigInt(hex)}`
//         }
//         case OpCode.SYSCALL: {
//             const buffer = Buffer.from(ins.operand!);
//             const hash = buffer.readUint32LE();
//             const sysCall = Object.entries(sysCallHash).find(v => v[1] === hash);
//             if (sysCall) { return sysCall[0]; }
//         }
//         case OpCode.CONVERT: return printStackItemType(ins.operand![0]);
//         case OpCode.LDSFLD:
//         case OpCode.STSFLD:
//         case OpCode.LDLOC:
//         case OpCode.STLOC:
//         case OpCode.LDARG:
//         case OpCode.STARG:
//             return `Slot Index ${ins.operand![0]}`;
//         default:
//             return undefined;
//     }
// }
