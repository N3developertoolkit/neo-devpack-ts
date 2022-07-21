import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { CompilationArtifacts, OperationContext } from "./compiler";

export function dumpOperations(operations?: OperationContext[]) {
    for (const op of operations ?? []) {
        console.log(` ${op.isPublic ? 'public ' : ''}${op.name}`);
        for (const { instruction, sourceReference } of op.builder.instructions) {
            const operand = instruction.operand ? Buffer.from(instruction.operand).toString('hex') : "";
            let msg = `  ${sc.OpCode[instruction.opCode]} ${operand}`
            if (sourceReference) {
                msg += " # " + sourceReference.print();
            }
            console.log(msg)
        }
    }
}

export function dumpArtifacts({ nef, methods }: CompilationArtifacts) {

    const starts = new Map(methods.map(m => [m.range.start, m]));
    const ends = new Map(methods.map(m => [m.range.end, m]));
    const points = new Map<number, tsm.Node>();
    for (const m of methods) {
        for (const [address, node] of m.sourceReferences) {
            points.set(address, node);
        }
    }

    const opTokens = sc.OpToken.fromScript(nef.script);
    let address = 0;
    for (const token of opTokens) {
        const s = starts.get(address);
        if (s) { console.log(`\x1b[95m# Method Start ${s.name}`); }
        const n = points.get(address);
        if (n) { console.log(`\x1b[96m# ${n.print()}\x1b[0m`); }

        let msg = `${address.toString().padStart(3)}: ${token.prettyPrint()}`;
        const comment = getComment(token);
        if (comment)
            msg += ` \x1b[96m# ${comment}\x1b[0m`;
        console.log(msg);

        const e = ends.get(address);
        if (e) { console.log(`\x1b[95m# Method End ${e.name}\x1b[0m`); }

        const size = token.toScript().length / 2;
        address += size;
    }
}

export function getComment(token: sc.OpToken): string | undefined {

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
            return `offset: ${offset}`;
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
            return `offset: ${offset}`;
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
