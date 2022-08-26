import { join } from "path";
import { readFile } from "fs/promises";
import * as tsm from "ts-morph";
import { compile, ConvertInstruction, createContractProject, FunctionSymbolDef, InitSlotInstruction, Instruction, InstructionKind, isJumpInstruction, isLoadStoreInstruction, LoadStoreInstruction, PushDataInstruction, PushIntInstruction, SysCallInstruction, TargetOffset, toDiagnostic } from '../packages/compiler/';
import util from 'util';
import { StackItemType } from "../packages/compiler/src/types/StackItem";

function printDiagnostics(diags: ReadonlyArray<tsm.ts.Diagnostic>) {
    const formatHost: tsm.ts.FormatDiagnosticsHost = {
        getCurrentDirectory: () => tsm.ts.sys.getCurrentDirectory(),
        getNewLine: () => tsm.ts.sys.newLine,
        getCanonicalFileName: (fileName: string) => tsm.ts.sys.useCaseSensitiveFileNames
            ? fileName : fileName.toLowerCase()
    }

    const msg = tsm.ts.formatDiagnosticsWithColorAndContext(diags, formatHost);
    console.log(msg);
}

async function main() {
    const project = await createContractProject();

    // load test contract
    const contractPath = join(__dirname, "contract.ts");
    const contractSource = await readFile(contractPath, 'utf8');

    project.createSourceFile("contract.ts", contractSource);
    project.resolveSourceFileDependencies();

    // console.time('getPreEmitDiagnostics');
    const diagnostics = project.getPreEmitDiagnostics();
    // console.timeEnd('getPreEmitDiagnostics')

    if (diagnostics.length > 0) {
        printDiagnostics(diagnostics.map(d => d.compilerObject));
        return;
    }

    try {
        const results = compile({ project });
        if (results.diagnostics.length > 0) {
            printDiagnostics(results.diagnostics);
            return;
        }

        for (const def of results.context.globals.symbolDefs) {
            if (def instanceof FunctionSymbolDef) {
                dumpFunctionDef(def);
            }
        }
    } catch (error) {
        printDiagnostics([toDiagnostic(error)]);
    }
}

main();

enum AnsiEscapeSequences {
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
const yellow = `${AnsiEscapeSequences.BrightYellow}%s${AnsiEscapeSequences.Reset}`;
const invert = `${AnsiEscapeSequences.Invert}%s${AnsiEscapeSequences.Reset}`;

export function dumpFunctionDef(def: FunctionSymbolDef) {
    const info = getOperationInfo(def.node);
    const params = info.parameters.map(p => `${p.name}: ${p.type.getText()}`).join(', ');
    const publicStr = info.isPublic ? 'public ' : '';
    const safeStr = info.safe ? ' [safe]' : '';
    console.log(magenta, `${publicStr}${info.name}(${params})${safeStr}`);

    const instructionMap = new Map<Instruction, number>();
    let insNum = 0;
    for (const ins of def.instructions) {
        if (ins instanceof tsm.Node) {
        } else {
            instructionMap.set(ins, ++insNum);
        }
    }
    const padding = `${instructionMap.size}`.length;
    function resolveTarget(target: TargetOffset) {
        if (!target.instruction) throw new Error(`Missing target`);
        const value = instructionMap.get(target.instruction);
        if (!value) throw new Error(`Invalid target`);
        return value
    }

    insNum = 0;
    for (const ins of def.instructions) {
        if (ins instanceof tsm.Node) {
            console.log(cyan, `# ${ins.print({ removeComments: true })}`);
        } else {
            let msg = util.format(invert, `${(++insNum).toString().padStart(padding)}:`);
            msg += " " + InstructionKind[ins.kind];

            const operand = getOperand(ins, insNum, resolveTarget);
            msg += util.format(yellow, " " + operand);
            const comment = getComment(ins, insNum, resolveTarget);
            if (comment) {
                msg += util.format(green, ` # ${comment}`);
            }
            console.log(msg);
        }
    }



    //     for (const op of operations ?? []) {
    //         const info = getOperationInfo(op.node);
    //         

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
}

function getOperationInfo(node: tsm.FunctionDeclaration) {
    return {
        name: node.getNameOrThrow(),
        safe: node.getJsDocs()
            .flatMap(d => d.getTags())
            .findIndex(t => t.getTagName() === 'safe') >= 0,
        isPublic: !!node.getExportKeyword(),
        returnType: node.getReturnType(),
        parameters: node.getParameters().map((p, index) => ({
            node: p,
            name: p.getName(),
            type: p.getType(),
            index
        }))
    }
}

function getOperand(ins: Instruction, num: number, resolveTarget: (target: TargetOffset) => number) {

    if (isLoadStoreInstruction(ins)) {
        return `${ins.index}`;
    }

    if (isJumpInstruction(ins)) {
        const target = resolveTarget(ins.target);
        const relative = target - num;
        return `${relative}`;
    }

    switch (ins.kind) {
        case InstructionKind.CONVERT: {
            const _ins = ins as ConvertInstruction;
            switch (_ins.type) {
                case StackItemType.Any: return "Any";
                case StackItemType.Pointer: return "Pointer";
                case StackItemType.Boolean: return "Boolean";
                case StackItemType.Integer: return "Integer";
                case StackItemType.ByteString: return "ByteString";
                case StackItemType.Buffer: return "Buffer";
                case StackItemType.Array: return "Array";
                case StackItemType.Struct: return "Struct";
                case StackItemType.Map: return "Map";
                case StackItemType.InteropInterface: return "InteropInterface";
                default: throw new Error(`Unexpected StackItemType ${_ins.type}`);
            }
        }
        case InstructionKind.PUSHINT: {
            const _ins = ins as PushIntInstruction;
            return `${_ins.value}`;
        }
        case InstructionKind.PUSHDATA: {
            const _ins = ins as PushDataInstruction;
            return "0x" + Buffer.from(_ins.value).toString('hex');
        }
        case InstructionKind.INITSLOT: {
            const _ins = ins as InitSlotInstruction;
            return "0x" + Buffer.from([_ins.localCount, _ins.paramCount]).toString('hex');
        }
        case InstructionKind.SYSCALL: {
            const _ins = ins as SysCallInstruction;
            return _ins.service;
        }
    }

    return "";
}

function getComment(ins: Instruction, num: number, resolveTarget: (target: TargetOffset) => number): string | undefined {

    if (isJumpInstruction(ins)) {
        const target = resolveTarget(ins.target);
        return `target: ${target}`;
    }

    switch (ins.kind) {
        case InstructionKind.PUSHDATA: {
            const _ins = ins as PushDataInstruction;
            const value = Buffer.from(_ins.value);
            return '' + value;

        }
        case InstructionKind.INITSLOT: {
            const _ins = ins as InitSlotInstruction;
            return `locals: ${_ins.localCount}, params: ${_ins.paramCount}`;
        }
        // case InstructionKind.SYSCALL: {
        //     const _ins = ins as SysCallInstruction;
        //     return `${_ins.service}`;
        // }
    }

    return undefined;

    // function resolveTarget(target: JumpTarget) {
    //     if (!target.instruction) { return "offset target not set"; }
    //     const index = findIndex(target.instruction);
    //     return index < 0 ? "offset target not found" : `offset target ${index}`;
    // }

    // if (isJumpInstruction(ins)) { 
    //     return resolveTarget(ins.target); 
    // }
    // if (isCallInstruction(ins)) {
    //     return `call ${ins.operation.node.getNameOrThrow()}`;
    // }
    // if (isTryInstruction(ins)) {
    //     const catchResolved = resolveTarget(ins.catchTarget);
    //     const finallyResolved = resolveTarget(ins.finallyTarget);
    //     return `catch ${catchResolved}, finally ${finallyResolved}`;
    // }

    // switch (ins.opCode) {
    //     case OpCode.PUSHINT8:
    //     case OpCode.PUSHINT16:
    //     case OpCode.PUSHINT32:
    //     case OpCode.PUSHINT64:
    //     case OpCode.PUSHINT128:
    //     case OpCode.PUSHINT256: {
    //         let hex = Buffer.from(ins.operand!).reverse().toString('hex');
    //         return `${BigInt(hex)}`
    //     }
    //     case OpCode.SYSCALL: {
    //         const buffer = Buffer.from(ins.operand!);
    //         const hash = buffer.readUint32LE();
    //         const sysCall = Object.entries(sysCallHash).find(v => v[1] === hash);
    //         if (sysCall) { return sysCall[0]; }
    //     }
    //     case OpCode.CONVERT: return printStackItemType(ins.operand![0]);
    //     case OpCode.LDSFLD:
    //     case OpCode.STSFLD:
    //     case OpCode.LDLOC:
    //     case OpCode.STLOC:
    //     case OpCode.LDARG:
    //     case OpCode.STARG:
    //         return `Slot Index ${ins.operand![0]}`;
    //     default:
    //         return undefined;
    // }
}
