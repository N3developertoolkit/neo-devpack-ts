import * as tsm from "ts-morph";
import { Immutable } from "./utility/Immutable";
import { separateInstructions } from "./ScriptBuilder";
import { CompileArtifacts, OperationInfo } from "./types/CompileContext";
import { sc } from "@cityofzion/neon-core";
import * as util from 'util';

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


export function dumpOperations(operations?: ReadonlyArray<OperationInfo>) {
    // for (const op of operations ?? []) {
    //     const [instructions, sourceReferences] = separateInstructions(op.instructions);
    //     console.log(` ${op.isPublic ? 'public ' : ''}${op.name}`);
    //     const length = instructions.length;
    //     for (let i = 0; i < length; i++) {
    //         const instruction = instructions[i];
    //         const sourceReference = sourceReferences.get(i);

    //         const operand = instruction.operand ? Buffer.from(instruction.operand).toString('hex') : "";
    //         let msg = `  ${sc.OpCode[instruction.opCode]} ${operand}`
    //         if (sourceReference) {
    //             msg += " # " + sourceReference.print();
    //         }
    //         console.log(msg)
    //     }
    // }
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

    const green = `${AnsiEscapeSequences.BrightGreen}%s${AnsiEscapeSequences.Reset}`;
    const cyan = `${AnsiEscapeSequences.BrightCyan}%s${AnsiEscapeSequences.Reset}`;
    const maegenta = `${AnsiEscapeSequences.BrightMagenta}%s${AnsiEscapeSequences.Reset}`;
    
    address = 0;
    for (const token of opTokens) {
        const s = starts.get(address);
        if (s) {  console.log(maegenta, `# Method Start ${s.name}`); }

        const n = points.get(address);
        if (n) { console.log(cyan, `# ${n.print()}`); }

        let msg = `${address.toString().padStart(padding)}: ${token.prettyPrint()}`;
        const comment = getComment(token, address);
        if (comment)
            msg += util.format(green, ` # ${comment}`);
        console.log(msg);

        const e = ends.get(address);
        if (e) { console.log(maegenta, `# Method End ${e.name}`); }

        const size = token.toScript().length / 2;
        address += size;
    }
}

export function getComment(token: sc.OpToken, address: number): string | undefined {

    const operand = token.params ? Buffer.from(token.params, 'hex') : undefined;

    switch (token.code) {
        case sc.OpCode.PUSHINT8:
        case sc.OpCode.PUSHINT16:
        case sc.OpCode.PUSHINT32:
        case sc.OpCode.PUSHINT64:
        case sc.OpCode.PUSHINT128:
        case sc.OpCode.PUSHINT256: {
            let hex = Buffer.from(operand!).reverse().toString('hex');
            return `${BigInt(hex)}`
        }
        case sc.OpCode.SYSCALL: {
            const entries = Object.entries(sc.InteropServiceCode);
            const entry = entries.find(t => t[1] === token.params!);
            return entry ? entry[0] : undefined;
        }
        case sc.OpCode.CONVERT: {
            return sc.StackItemType[operand![0]];
        }

        case sc.OpCode.JMP:
        case sc.OpCode.JMPIF:
        case sc.OpCode.JMPIFNOT:
        case sc.OpCode.JMPEQ:
        case sc.OpCode.JMPNE:
        case sc.OpCode.JMPGT:
        case sc.OpCode.JMPGE:
        case sc.OpCode.JMPLT:
        case sc.OpCode.JMPLE:
        case sc.OpCode.ENDTRY:
        case sc.OpCode.CALL: {
            const offset = operand![0];
            return `offset: ${offset}, position: ${address + offset}`;
        }
        case sc.OpCode.JMP_L:
        case sc.OpCode.JMPIF_L:
        case sc.OpCode.JMPIFNOT_L:
        case sc.OpCode.JMPEQ_L:
        case sc.OpCode.JMPNE_L:
        case sc.OpCode.JMPGT_L:
        case sc.OpCode.JMPGE_L:
        case sc.OpCode.JMPLT_L:
        case sc.OpCode.JMPLE_L:
        case sc.OpCode.ENDTRY_L:
        case sc.OpCode.CALL_L: {
            const offset = Buffer.from(operand!).readInt32LE();
            return `offset: ${offset}, position: ${address + offset}`;
        }
        case sc.OpCode.LDSFLD:
        case sc.OpCode.STSFLD:
        case sc.OpCode.LDLOC:
        case sc.OpCode.STLOC:
        case sc.OpCode.LDARG:
        case sc.OpCode.STARG: 
            return `Slot Index ${operand![0]}`;
        default:
            return undefined;
    }
}
