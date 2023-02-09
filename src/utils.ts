import * as tsm from "ts-morph";
import { ContractMethod } from "../packages/compiler/src/passes/processFunctionDeclarations";
import { CallOperation, CallTokenOperation, ConvertOperation, InitSlotOperation, JumpOperation, LoadStoreOperation, Location, Operation, PushDataOperation, PushIntOperation, SysCallOperation } from "../packages/compiler/src/types/Operation";

export function dumpContractMethod(method: ContractMethod) {
    console.log(magenta, `Method: ${method.def.node.getSymbolOrThrow().getName()}`);
    method.operations.forEach((v, i) => {
        if (v.location) { console.log(cyan, `  ${dumpLocation(v.location)}`); }
        console.log(`    ${i}: ${dumpOperation(v, i)}`);
    })
}

function dumpLocation(location: Location) {
    if (tsm.Node.isNode(location)) {
        return location.print();
    } else {
        const src = location.start.getSourceFile().getFullText();
        const start = location.start.getStart();
        const end = location.end.getEnd();
        return src.substring(start, end);
    }
}

function dumpOperation(op: Operation, currentIndex: number) {
    switch (op.kind) {
        case 'convert': {
            const { type } = op as ConvertOperation;
            return `${op.kind} ${type}`
        }
        case 'calltoken': {
            const { token } = op as CallTokenOperation;
            return `${op.kind} ${token.hash} ${token.method}`
        }
        case 'initslot': {
            const { locals, params } = op as InitSlotOperation;
            return `${op.kind} ${locals} locals ${params} params`
        }
        case 'call': {
            const { method } = op as CallOperation;
            return `${op.kind} ${method.symbol.getName()}`
        }
        case 'jump':
        case 'jumpif':
        case 'jumpifnot':
        case 'jumpeq':
        case "jumpne":
        case "jumpgt":
        case "jumpge":
        case "jumplt":
        case "jumple": {
            const { offset } = op as JumpOperation;
            return `${op.kind} ${offset} (${offset + currentIndex})`
        }
        case 'syscall':{
            const { name } = op as SysCallOperation;
            return `${op.kind} ${name}`
        }
        case 'loadarg':
        case 'loadlocal':
        case 'loadstatic':
        case 'storearg':
        case 'storelocal':
        case 'storestatic': {
            const { index } = op as LoadStoreOperation
            return `${op.kind} ${index}`
        }
        case 'pushdata': {
            const { value } = op as PushDataOperation;
            const buffer = Buffer.from(value);
            return `${op.kind} 0x${buffer.toString('hex')} "${buffer.toString('utf8')}"`;
        }
        case 'pushint': {
            const { value } = op as PushIntOperation;
            return `${op.kind} ${value}`
        }
        default:
            return `${op.kind}`
    }

}
// // export function dumpFunctionContext(ctx: FunctionContext) {
// //     const info = getFunctionInfo(ctx.node);
// //     const params = info.parameters.map(p => `${p.name}: ${p.type.getText()}`).join(', ');
// //     const publicStr = info.isPublic ? 'public ' : '';
// //     const safeStr = info.safe ? ' [safe]' : '';
// //     console.log(magenta, `${publicStr}${info.name}(${params})${safeStr}`);

// //     const operations = ctx.operations ?? [];
// //     const padding = `${operations.length}`.length;

// //     for (let i = 0; i < operations.length; i++) {
// //         const op = operations[i];
// //         if (op.location) {
// //             console.log(cyan, ` # ${op.location.print({ removeComments: true })}`);
// //         }
// //         let msg = util.format(invert, `${(i).toString().padStart(padding)}:`);
// //         msg += " " + OperationKind[op.kind];
// //         const operand = getOperand(op);
// //         msg += util.format(yellow, " " + operand);
// //         const comment = getComment(op, i);
// //         if (comment) {
// //             msg += util.format(green, ` # ${comment}`);
// //         }
// //         console.log(msg);
// //     }
// // }

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

export const green = `${AnsiEscapeSequences.BrightGreen}%s${AnsiEscapeSequences.Reset}`;
export const cyan = `${AnsiEscapeSequences.BrightCyan}%s${AnsiEscapeSequences.Reset}`;
export const magenta = `${AnsiEscapeSequences.BrightMagenta}%s${AnsiEscapeSequences.Reset}`;
export const yellow = `${AnsiEscapeSequences.BrightYellow}%s${AnsiEscapeSequences.Reset}`;
export const blue = `${AnsiEscapeSequences.BrightBlue}%s${AnsiEscapeSequences.Reset}`;
export const invert = `${AnsiEscapeSequences.Invert}%s${AnsiEscapeSequences.Reset}`;

// export function getFunctionInfo(node: FunctionDeclaration) {
//     return {
//         name: node.getNameOrThrow(),
//         safe: node.getJsDocs()
//             .flatMap(d => d.getTags())
//             .findIndex(t => t.getTagName() === 'safe') >= 0,
//         isPublic: !!node.getExportKeyword(),
//         returnType: node.getReturnType(),
//         parameters: node.getParameters().map((p, index) => ({
//             node: p,
//             name: p.getName(),
//             type: p.getType(),
//             index
//         }))
//     }
// }

// export function getOperand(op: Operation) {

//     if (isLoadStoreOperation(op)) {
//         return `${op.index}`;
//     }

//     if (isJumpOperation(op)) {
//         return op.offset > 0 ? `+${op.offset}` : `${op.offset}`;
//     }

//     switch (op.kind) {
//         case OperationKind.CALL: {
//             const _ins = op as CallOperation;
//             return _ins.symbol.getName();
//         }
//         case OperationKind.CONVERT: {
//             const _ins = op as ConvertOperation;
//             return `${_ins.type}`;
//         }
//         case OperationKind.PUSHINT: {
//             const _ins = op as PushIntOperation;
//             return `${_ins.value}`;
//         }
//         case OperationKind.PUSHDATA: {
//             const _ins = op as PushDataOperation;
//             return "0x" + Buffer.from(_ins.value).toString('hex');
//         }
//         case OperationKind.INITSLOT: {
//             const _ins = op as InitSlotOperation;
//             return "0x" + Buffer.from([_ins.localCount, _ins.paramCount]).toString('hex');
//         }
//         case OperationKind.SYSCALL: {
//             const _ins = op as SysCallOperation;
//             return _ins.service;
//         }
//     }

//     return "";
// }

// export function getComment(op: Operation, curIndex: number): string | undefined {

//     if (isJumpOperation(op)) {
//         const target = curIndex + op.offset;
//         return `target: ${target}`;
//     }

//     switch (op.kind) {
//         case OperationKind.CONVERT: {
//             const _ins = op as ConvertOperation;
//             return sc.StackItemType[_ins.type];
//         }
//         case OperationKind.PUSHDATA: {
//             const _ins = op as PushDataOperation;
//             const value = Buffer.from(_ins.value);
//             return '' + value;
//         }
//         case OperationKind.INITSLOT: {
//             const _ins = op as InitSlotOperation;
//             return `locals: ${_ins.localCount}, params: ${_ins.paramCount}`;
//         }
//         case OperationKind.SYSCALL: {
//             const _ins = op as SysCallOperation;
//             switch (_ins.service) {
//                 case sc.InteropServiceCode.SYSTEM_CONTRACT_CALL:
//                     return "SYSTEM_CONTRACT_CALL";
//                 case sc.InteropServiceCode.SYSTEM_CONTRACT_CALLNATIVE:
//                     return "SYSTEM_CONTRACT_CALLNATIVE";
//                 case sc.InteropServiceCode.SYSTEM_CONTRACT_CREATEMULTISIGACCOUNT:
//                     return "SYSTEM_CONTRACT_CREATEMULTISIGACCOUNT";
//                 case sc.InteropServiceCode.SYSTEM_CONTRACT_CREATESTANDARDACCOUNT:
//                     return "SYSTEM_CONTRACT_CREATESTANDARDACCOUNT";
//                 case sc.InteropServiceCode.SYSTEM_CONTRACT_GETCALLFLAGS:
//                     return "SYSTEM_CONTRACT_GETCALLFLAGS";
//                 case sc.InteropServiceCode.SYSTEM_CONTRACT_NATIVEONPERSIST:
//                     return "SYSTEM_CONTRACT_NATIVEONPERSIST";
//                 case sc.InteropServiceCode.SYSTEM_CONTRACT_NATIVEPOSTPERSIST:
//                     return "SYSTEM_CONTRACT_NATIVEPOSTPERSIST";
//                 case sc.InteropServiceCode.SYSTEM_CRYPTO_CHECKMULTISIG:
//                     return "SYSTEM_CRYPTO_CHECKMULTISIG";
//                 case sc.InteropServiceCode.SYSTEM_CRYPTO_CHECKSIG:
//                     return "SYSTEM_CRYPTO_CHECKSIG";
//                 case sc.InteropServiceCode.SYSTEM_ITERATOR_NEXT:
//                     return "SYSTEM_ITERATOR_NEXT";
//                 case sc.InteropServiceCode.SYSTEM_ITERATOR_VALUE:
//                     return "SYSTEM_ITERATOR_VALUE";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_BURNGAS:
//                     return "SYSTEM_RUNTIME_BURNGAS";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_CHECKWITNESS:
//                     return "SYSTEM_RUNTIME_CHECKWITNESS";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GASLEFT:
//                     return "SYSTEM_RUNTIME_GASLEFT";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETADDRESSVERSION:
//                     return "SYSTEM_RUNTIME_GETADDRESSVERSION";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETCALLINGSCRIPTHASH:
//                     return "SYSTEM_RUNTIME_GETCALLINGSCRIPTHASH";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETENTRYSCRIPTHASH:
//                     return "SYSTEM_RUNTIME_GETENTRYSCRIPTHASH";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETEXECUTINGSCRIPTHASH:
//                     return "SYSTEM_RUNTIME_GETEXECUTINGSCRIPTHASH";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETINVOCATIONCOUNTER:
//                     return "SYSTEM_RUNTIME_GETINVOCATIONCOUNTER";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETNETWORK:
//                     return "SYSTEM_RUNTIME_GETNETWORK";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETNOTIFICATIONS:
//                     return "SYSTEM_RUNTIME_GETNOTIFICATIONS";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETRANDOM:
//                     return "SYSTEM_RUNTIME_GETRANDOM";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETSCRIPTCONTAINER:
//                     return "SYSTEM_RUNTIME_GETSCRIPTCONTAINER";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETTIME:
//                     return "SYSTEM_RUNTIME_GETTIME";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_GETTRIGGER:
//                     return "SYSTEM_RUNTIME_GETTRIGGER";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_LOG:
//                     return "SYSTEM_RUNTIME_LOG";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_NOTIFY:
//                     return "SYSTEM_RUNTIME_NOTIFY";
//                 case sc.InteropServiceCode.SYSTEM_RUNTIME_PLATFORM:
//                     return "SYSTEM_RUNTIME_PLATFORM";
//                 case sc.InteropServiceCode.SYSTEM_STORAGE_ASREADONLY:
//                     return "SYSTEM_STORAGE_ASREADONLY";
//                 case sc.InteropServiceCode.SYSTEM_STORAGE_DELETE:
//                     return "SYSTEM_STORAGE_DELETE";
//                 case sc.InteropServiceCode.SYSTEM_STORAGE_FIND:
//                     return "SYSTEM_STORAGE_FIND";
//                 case sc.InteropServiceCode.SYSTEM_STORAGE_GET:
//                     return "SYSTEM_STORAGE_GET";
//                 case sc.InteropServiceCode.SYSTEM_STORAGE_GETCONTEXT:
//                     return "SYSTEM_STORAGE_GETCONTEXT";
//                 case sc.InteropServiceCode.SYSTEM_STORAGE_GETREADONLYCONTEXT:
//                     return "SYSTEM_STORAGE_GETREADONLYCONTEXT";
//                 case sc.InteropServiceCode.SYSTEM_STORAGE_PUT:
//                     return "SYSTEM_STORAGE_PUT";
//             }
//         }
//     }

//     return undefined;
// }

// export function dumpArtifacts({ nef, debugInfo }: CompileArtifacts) {
//     const starts = new Map(debugInfo.methods?.map(m => [m.range.start, m]))
//     const ends = new Map(debugInfo.methods?.map(m => [m.range.end, m]));
//     const locationMap = new Map(debugInfo.methods
//         ?.flatMap(m => m.sequencePoints ?? [])
//         .map(sp => [sp.address, sp.location]) ?? []);
//     const opTokens = sc.OpToken.fromScript(nef.script);
//     const padding = `${opTokens.length}`.length;
//     let address = 0;
//     for (const token of opTokens) {
//         const s = starts.get(address);
//         if (s) { console.log(magenta, `# Method Start ${s.name}`); }
//         const loc = locationMap.get(address);
//         if (loc) {
//             console.log(cyan, loc.print({ removeComments: true }));
//         }
//         let msg = util.format(invert, `${(address).toString().padStart(padding)}:`);
//         msg += ` ${token.prettyPrint()}`;
//         const comment = getOpTokenComment(token, address);
//         if (comment) {
//             msg += util.format(green, ` # ${comment}`);
//         }
//         console.log(msg);
//         const e = ends.get(address);
//         if (e) { console.log(magenta, `# Method End ${e.name}`); }

//         const size = token.toScript().length / 2
//         address += size;
//     }
// }

// function getOpTokenComment(token: sc.OpToken, address: number): string | undefined {
//     if (!token.params) return undefined;
//     const operand = Buffer.from(token.params, 'hex');


//     if (sc.OpCode.JMP <= token.code && token.code <= sc.OpCode.CALL_L) {
//         const offset = operand.length === 1
//             ? operand.readInt8() : operand.readInt32LE();
//         return `offset: ${offset}, target: ${address + offset}`;
//     }

//     switch (token.code) {
//         case sc.OpCode.PUSHINT8:
//         case sc.OpCode.PUSHINT16:
//         case sc.OpCode.PUSHINT32:
//         case sc.OpCode.PUSHINT64:
//         case sc.OpCode.PUSHINT128:
//         case sc.OpCode.PUSHINT256: {
//             let hex = Buffer.from(operand!).reverse().toString('hex');
//             return `${BigInt(hex)}`
//         }
//         case sc.OpCode.SYSCALL: {
//             const entries = Object.entries(sc.InteropServiceCode);
//             const entry = entries.find(t => t[1] === token.params!);
//             return entry ? entry[0] : undefined;
//         }
//         case sc.OpCode.CONVERT: {
//             return sc.StackItemType[operand![0]];
//         }
//         case sc.OpCode.INITSLOT: {
//             const localCount = operand[0];
//             const paramCount = operand[1];
//             return `locals: ${localCount}, params: ${paramCount}`;
//         }
//     }


//     return undefined;
// }