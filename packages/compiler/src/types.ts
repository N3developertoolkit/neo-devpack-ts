import { sc } from "@cityofzion/neon-core";
import { Project } from "ts-morph";
import { DebugInfo } from "./debugInfo";

export interface CompileContext {
    project: Project;
}

export interface CompileResults {
    script: Uint8Array;
    manifest: sc.ContractManifest,
    debugInfo: DebugInfo,
}

export interface Instruction {
    opCode: sc.OpCode;
    operand?: Uint8Array;
}

function createInstruction(opCode: sc.OpCode, operand: Iterable<number>) {
    return {
        opCode,
        operand: operand instanceof Uint8Array
        ? operand : Uint8Array.from(operand)
    }
}

function toArray(instruction: Instruction) {
    return instruction.operand
        ? Uint8Array.from([instruction.opCode, ...instruction.operand])
        : Uint8Array.from([instruction.opCode]);
}

