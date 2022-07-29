import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { combineInstructions, Instruction, separateInstructions } from "./ScriptBuilder";
import { OperationInfo } from "./types/CompileContext";

export function optimizeReturn(op: OperationInfo): OperationInfo | undefined {
    // if (!op.instructions) 
    return undefined;
    // const [instructions, sourceReferences] = separateInstructions(op.instructions);
    // const newIns = new Array<Instruction>();
    // const newRef = new Map<number, tsm.Node>();

    // let dirty = false;
    // const length = instructions.length;
    // for (let i = 0; i < length; i++) {

    //     const ins = instructions[i];
    //     const ref = sourceReferences.get(i);

    //     /*
    //         Convert This Pattern:
    //             JMP_L 06000000 # offset: 6
    //           * NOP (source reference)
    //             RET
        
    //         To this
    //           * RET (source reference)
    //     */
    //     if (ins.opCode === sc.OpCode.JMP_L
    //         && i + 2 < length
    //         && instructions[i + 1].opCode === sc.OpCode.NOP
    //         && instructions[i + 2].opCode === sc.OpCode.RET
    //         && !ref
    //         && sourceReferences.has(i + 1)
    //         && !sourceReferences.has(i + 2)) {
    //         const ins2 = instructions[i + 2];
    //         const ref2 = sourceReferences.get(i + 1);

    //         const len = newIns.push(ins2);
    //         newRef.set(len - 1, ref2!);
    //         i += 2;
    //         dirty = true;
    //         continue;
    //     }

    //     /*
    //         Convert This Pattern:
    //           * NOP (source reference)
    //             RET
        
    //         To this
    //           * RET (source reference)
    //     */
    //     if (ins.opCode === sc.OpCode.NOP
    //         && i + 1 < length
    //         && instructions[i + 1].opCode === sc.OpCode.RET
    //         && !!ref
    //         && !sourceReferences.has(i + 1)) {

    //         const ins2 = instructions[i + 1];

    //         const len = newIns.push(ins2);
    //         newRef.set(len - 1, ref);
    //         i += 1;
    //         dirty = true;
    //         continue;
    //     }

    //     const len = newIns.push(ins);
    //     if (ref) { newRef.set(len - 1, ref); }
    // }

    // if (!dirty) { return undefined; }

    // return {
    //     node: op.node,
    //     name: op.name,
    //     isPublic: op.isPublic,
    //     parameters: op.parameters,
    //     returnType: op.returnType,
    //     instructions: combineInstructions(newIns, newRef),
    // };
}
