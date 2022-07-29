import * as tsm from "ts-morph";
import { Immutable } from "./utility/Immutable";
import { CompileArtifacts, OperationInfo } from "./types/CompileContext";
import { sc } from "@cityofzion/neon-core";
import * as util from 'util';
import { OpCode, print as printOpCode } from "./types/OpCode";
import { isInstruction, isNode, sysCallHash } from "./types/OperationBuilder";
import { Instruction, isJumpInstruction, isTryInstruction, JumpInstruction, JumpTarget } from "./types/Instruction";

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

export function dumpOperations(operations?: ReadonlyArray<OperationInfo>) {
    for (const op of operations ?? []) {
        const params = op.parameters.map(p => `${p.name}: ${p.type.getText()}`).join(', ');
        const publicStr = op.isPublic ? 'public ' : '';
        const safeStr = op.safe ? ' [safe]' : '';
        console.log(magenta, `${publicStr}${op.name}(${params})${safeStr}`);

        const instructions = op.instructions ?? [];
        const insOnly = instructions.filter(isInstruction);
        const instructionsLength = instructions.length;
        for (let i = 0; i < instructionsLength; i++) {
            const item = instructions[i];
            if (isNode(item)) {
                console.log(cyan, `# ${item.print()}`);
            } else {
                let msg = printOpCode(item.opCode);
                if (item.operand) {
                    msg += ` ${Buffer.from(item.operand).toString('hex')}`;
                }
                const comment = getComment(item, insOnly);
                if (comment) {
                    msg += util.format(cyan, ` # ${comment}`);
                }
                console.log(`${i}: ${msg}`);
            }
        }
    }
}

export function dumpArtifacts({ nef, methods }: Immutable<CompileArtifacts>) {

    const starts = new Map(methods.map(m => [m.range.start, m]));
    const ends = new Map(methods.map(m => [m.range.end, m]));
    const points = new Map<number, tsm.Node>();
    for (const m of methods) {
        for (const [address, node] of m.sequencePoints) {
            points.set(address, node);
        }
    }

    const opTokens = sc.OpToken.fromScript(nef.script);
    let address = 0;
    for (const token of opTokens) {
        const size = token.toScript().length / 2;
        address += size;
    }

    const padding = `${address}`.length;


    address = 0;
    for (const token of opTokens) {
        const s = starts.get(address);
        if (s) { console.log(magenta, `# Method Start ${s.name}`); }

        const n = points.get(address);
        if (n) { console.log(cyan, `# ${n.print()}`); }

        let msg = `${address.toString().padStart(padding)}: ${token.prettyPrint()}`;
        // const comment = getComment(token, address);
        // if (comment)
        //     msg += util.format(green, ` # ${comment}`);
        console.log(msg);

        const e = ends.get(address);
        if (e) { console.log(magenta, `# Method End ${e.name}`); }

        const size = token.toScript().length / 2;
        address += size;
    }
}

export function getComment(ins: Instruction, instructions: ReadonlyArray<Instruction>): string | undefined {

    function resolveTarget(target: JumpTarget) {
        if (!target.instruction) { return "offset target not set"; }
        const index = instructions.findIndex(v => v === target.instruction);
        return index < 0 ? "offset target not found" : `offset target ${index}`;
    }

    if (isJumpInstruction(ins)) { return resolveTarget(ins.target); }
    if (isTryInstruction(ins)) {
        const catchResolved = resolveTarget(ins.catchTarget);
        const finallyResolved = resolveTarget(ins.finallyTarget);
        return `catch ${catchResolved}, finally ${finallyResolved}`;
    }

    switch (ins.opCode) {
        case OpCode.PUSHINT8:
        case OpCode.PUSHINT16:
        case OpCode.PUSHINT32:
        case OpCode.PUSHINT64:
        case OpCode.PUSHINT128:
        case OpCode.PUSHINT256: {
            let hex = Buffer.from(ins.operand!).reverse().toString('hex');
            return `${BigInt(hex)}`
        }
        case OpCode.SYSCALL: {
            const buffer = Buffer.from(ins.operand!);
            const hash = buffer.readUint32LE();
            const sysCall = Object.entries(sysCallHash).find(v => v[1] === hash);
            if (sysCall) { return sysCall[0]; }
        }
        case OpCode.CONVERT: {
            return sc.StackItemType[ins.operand![0]];
        }
        case OpCode.LDSFLD:
        case OpCode.STSFLD:
        case OpCode.LDLOC:
        case OpCode.STLOC:
        case OpCode.LDARG:
        case OpCode.STARG:
            return `Slot Index ${ins.operand![0]}`;
        default:
            return undefined;
    }
}
