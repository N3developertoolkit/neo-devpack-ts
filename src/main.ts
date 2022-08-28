import { join } from "path";
import { readFile } from "fs/promises";
import * as tsm from "ts-morph";
import { compile, ConvertOperation, createContractProject, FunctionSymbolDef, InitSlotOperation, Operation, OperationKind, isJumpOperation, isLoadStoreOperation, LoadStoreOperation, PushDataOperation, PushIntOperation, SysCallOperation, toDiagnostic, FunctionContext } from '../packages/compiler/';
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

        for (const func of results.context.functions) {
            dumpFunctionOperations(func);
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

export function dumpFunctionOperations(ctx: FunctionContext) {
    const info = getFunctionInfo(ctx.node);
    const params = info.parameters.map(p => `${p.name}: ${p.type.getText()}`).join(', ');
    const publicStr = info.isPublic ? 'public ' : '';
    const safeStr = info.safe ? ' [safe]' : '';
    console.log(magenta, `${publicStr}${info.name}(${params})${safeStr}`);

    const operations = ctx.operations ?? [];
    const padding = `${operations.length}`.length;

    for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        let msg = util.format(invert, `${(i).toString().padStart(padding)}:`);
        if (op instanceof tsm.Node) {
            msg += util.format(cyan, ` # ${op.print({ removeComments: true })}`);
        } else {
            msg += " " + OperationKind[op.kind];
            const operand = getOperand(op);
            msg += util.format(yellow, " " + operand);
            const comment = getComment(op, i);
            if (comment) {
                msg += util.format(green, ` # ${comment}`);
            }
        }
        console.log(msg);
    }
}

function getFunctionInfo(node: tsm.FunctionDeclaration) {
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

function getOperand(op: Operation) {

    if (isLoadStoreOperation(op)) {
        return `${op.index}`;
    }

    if (isJumpOperation(op)) {
        return `${op.offset}`;
    }

    switch (op.kind) {
        case OperationKind.CONVERT: {
            const _ins = op as ConvertOperation;
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
        case OperationKind.PUSHINT: {
            const _ins = op as PushIntOperation;
            return `${_ins.value}`;
        }
        case OperationKind.PUSHDATA: {
            const _ins = op as PushDataOperation;
            return "0x" + Buffer.from(_ins.value).toString('hex');
        }
        case OperationKind.INITSLOT: {
            const _ins = op as InitSlotOperation;
            return "0x" + Buffer.from([_ins.localCount, _ins.paramCount]).toString('hex');
        }
        case OperationKind.SYSCALL: {
            const _ins = op as SysCallOperation;
            return _ins.service;
        }
    }

    return "";
}

function getComment(op: Operation, curIndex: number): string | undefined {

    if (isJumpOperation(op)) {
        const target = curIndex + op.offset;
        return `target: ${target}`;
    }

    switch (op.kind) {
        case OperationKind.PUSHDATA: {
            const _ins = op as PushDataOperation;
            const value = Buffer.from(_ins.value);
            return '' + value;

        }
        case OperationKind.INITSLOT: {
            const _ins = op as InitSlotOperation;
            return `locals: ${_ins.localCount}, params: ${_ins.paramCount}`;
        }
    }

    return undefined;
}
