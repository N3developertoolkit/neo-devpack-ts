import { readdirSync, statSync, readFileSync } from "fs";
import { dirname, join } from "path";

import * as tsm from "ts-morph";
import { sc, u } from "@cityofzion/neon-core";

import * as O from 'fp-ts/Option';
import * as E from "fp-ts/Either";
import * as SEP from 'fp-ts/Separated';
import * as ROA from 'fp-ts/ReadonlyArray';

export function isArray<T>(value: T | readonly T[]): value is readonly T[] {
    return Array.isArray(value);
}

interface ReduceDispatchContext {
    readonly errors: readonly ParseError[];
}

export type ReduceDispatchMap<T extends ReduceDispatchContext> = {
    [TKind in tsm.SyntaxKind]?: (context: T, node: tsm.KindToNodeMappings[TKind]) => T;
};

export const dispatchReduce =
    <T extends ReduceDispatchContext>(name: string, dispatchMap: ReduceDispatchMap<T>) =>
        (context: T, node: tsm.Node) => {
            const dispatchFunction = dispatchMap[node.getKind()];
            if (dispatchFunction) {
                return dispatchFunction(context, node as any);
            } else {
                const error = makeParseError(node)(`${name} ${node.getKindName()} not implemented`);
                return updateContextErrors(context)(error);
            }
        }

export const updateContextErrors =
    <T extends ReduceDispatchContext>(context: T) =>
        (errors: ParseError | readonly ParseError[]): T => {

            const $errors = isArray(errors)
                ? ROA.concat(errors)(context.errors)
                : ROA.append(errors)(context.errors);
            return { ...context, errors: $errors };
        }

export const E_fromSeparated = <E, A>(s: SEP.Separated<readonly E[], A>): E.Either<readonly E[], A> =>
    ROA.isNonEmpty(s.left) ? E.left(s.left) : E.of(s.right)

export function single<T>(array: readonly T[]): O.Option<T> {
    return array.length === 1 ? O.some(array[0] as T) : O.none;
}

export function makeReadOnlyMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
    return new Map<K, V>(entries);
}

export function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
    return input != null;
}

export interface DiagnosticOptions {
    code?: number,
    node?: tsm.Node,
    category?: tsm.ts.DiagnosticCategory
};

export function notImpl(options: DiagnosticOptions) {
    return createDiagnostic("not implemented", options);
}

export function createDiagnostic(messageText: string, options?: DiagnosticOptions): tsm.ts.Diagnostic {
    const node = options?.node;
    const category = options?.category ?? tsm.ts.DiagnosticCategory.Error;
    const code = options?.code ?? 0;
    return {
        category,
        code,
        file: node?.getSourceFile().compilerNode,
        length: node ? node.getEnd() - node.getPos() : undefined,
        messageText,
        start: node?.getPos(),
        source: node?.print()
    };
}

export function getErrorMessage(error: string | unknown) {
    return typeof error === 'string'
        ? error
        : error instanceof Error
            ? error.message
            : String(error);
}

export class CompileError extends Error {
    constructor(
        message: string,
        public readonly node: tsm.Node
    ) {
        super(message);
    }
}

export interface ParseError {
    message: string,
    node?: tsm.Node
}

export const makeParseError =
    (node?: tsm.Node) =>
        (error: string | unknown): ParseError => {
            return { message: getErrorMessage(error), node };
        }

export const makeParseDiagnostic = (e: ParseError) => createDiagnostic(e.message, { node: e.node });



export function toDiagnostic(error: string | unknown): tsm.ts.Diagnostic {
    const message = getErrorMessage(error);
    const node = error instanceof CompileError ? error.node : undefined;
    return createDiagnostic(message, { node });
}

export function createContractProject() {
    const project = new tsm.Project({
        compilerOptions: {
            // specify lib file directly to avoid bringing in web apis like DOM and WebWorker
            lib: ["lib.es2020.d.ts"],
            types: ["@neo-project/neo-contract-framework"],
            target: tsm.ts.ScriptTarget.ES2020,
            moduleResolution: tsm.ts.ModuleResolutionKind.Node10,
        },
        useInMemoryFileSystem: true,
    });
    const projFS = project.getFileSystem();

    const scfxPackage = require.resolve("@neo-project/neo-contract-framework/package.json");
    const sourceFolder = dirname(scfxPackage)
    const targetFolder = "/node_modules/@neo-project/neo-contract-framework";

    const files = readdirSync(sourceFolder)
    for (const file of files) {
        const filePath = join(sourceFolder, file);
        const fileStat = statSync(filePath)
        if (fileStat.isDirectory()) continue;
        const fileContents = readFileSync(filePath, 'utf8');
        projFS.writeFile(join(targetFolder, file), fileContents);
    }

    return project;
}

const checkFlags = (type: tsm.Type, flags: tsm.ts.TypeFlags) => (type.getFlags() & flags) !== 0;

export const isBigIntLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.BigIntLike);
export const isBooleanLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.BooleanLike);
export const isNumberLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.NumberLike);
export const isStringLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.StringLike);
export const isVoidLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.VoidLike);
export const isIntegerLike = (type: tsm.Type) => isBigIntLike(type) || isNumberLike(type);

export function isConst(node: tsm.TypeNode) {
    if (tsm.Node.isTypeReference(node)) {
        const typeName = node.getTypeName();
        if (typeName instanceof tsm.Identifier) {
            return typeName.compilerNode.originalKeywordKind === tsm.SyntaxKind.ConstKeyword;
        }
    }
    return false;
}

export function isCompoundAssignment(kind: tsm.SyntaxKind) {
    switch (kind) {
        case tsm.SyntaxKind.PlusEqualsToken:
        case tsm.SyntaxKind.MinusEqualsToken:
        case tsm.SyntaxKind.AsteriskAsteriskEqualsToken:
        case tsm.SyntaxKind.AsteriskEqualsToken:
        case tsm.SyntaxKind.SlashEqualsToken:
        case tsm.SyntaxKind.PercentEqualsToken:
        case tsm.SyntaxKind.AmpersandEqualsToken:
        case tsm.SyntaxKind.BarEqualsToken:
        case tsm.SyntaxKind.CaretEqualsToken:
        case tsm.SyntaxKind.LessThanLessThanEqualsToken:
        case tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
        case tsm.SyntaxKind.GreaterThanGreaterThanEqualsToken:
        case tsm.SyntaxKind.BarBarEqualsToken:
        case tsm.SyntaxKind.AmpersandAmpersandEqualsToken:
        case tsm.SyntaxKind.QuestionQuestionEqualsToken:
            return true;
        default:
            return false;
    }
}

export function hasErrors(diagnostics: readonly tsm.ts.Diagnostic[]) {
    for (const diag of diagnostics) {
        if (diag.category === tsm.ts.DiagnosticCategory.Error) return true;
    }
    return false;
}

// export function getConstantValue(node: tsm.Expression) {
//     switch (node.getKind()) {
//         case tsm.SyntaxKind.NullKeyword:
//             return null;
//         case tsm.SyntaxKind.FalseKeyword:
//             return false;
//         case tsm.SyntaxKind.TrueKeyword:
//             return true;
//         case tsm.SyntaxKind.BigIntLiteral:
//             return (node as tsm.BigIntLiteral).getLiteralValue() as bigint;
//         case tsm.SyntaxKind.NumericLiteral: {
//             const literal = (node as tsm.NumericLiteral).getLiteralValue();
//             if (!Number.isInteger(literal)) throw new CompileError(`invalid non-integer numeric literal`, node);
//             return BigInt(literal);
//         }
//         case tsm.SyntaxKind.StringLiteral: {
//             const literal = (node as tsm.StringLiteral).getLiteralValue();
//             return <ReadonlyUint8Array>Buffer.from(literal, 'utf8');
//         }
//         // case tsm.SyntaxKind.ArrayLiteralExpression: 
//         // case tsm.SyntaxKind.ObjectLiteralExpression:
//         default:
//             throw new CompileError(`Unsupported const type ${node.getKindName()}`, node);
//     }
// }

export function getJSDocTag(node: tsm.JSDocableNode, tagName: string): tsm.JSDocTag | undefined {
    for (const doc of node.getJsDocs()) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() === tagName) return tag;
        }
    }
    return undefined
}


export function convertBigInteger(value: bigint) {
    // neon-js BigInteger is not directly compatible with JS bigint type
    // but we can go bigint -> string -> BigInteger to convert
    const $value = u.BigInteger.fromNumber(value.toString());
    const token = sc.OpToken.forInteger($value);
    return {
        opCode: token.code,
        buffer: Buffer.from(token.params!, 'hex')
    };
}

function toHexString(value: bigint): string {
    let str = value.toString(16);
    return str.length % 2 === 1 ? '0' + str : str;
}
function toBuffer(value: bigint): Buffer {
    return Buffer.from(toHexString(value), 'hex');
}

function allBitsSet(buffer: Uint8Array): boolean {
    const length = buffer.length;
    for (let i = 0; i < length; i++) {
        if (buffer[i] !== 0xff) return false;
    }
    return true;
}

function toBigInt(buffer: Buffer): bigint {
    return BigInt(`0x${buffer.toString('hex')}`);
}

// convert JS BigInt to C# BigInt byte array encoding
// export function bigIntToByteArray(value: bigint): Uint8Array {
//     if (value >= 0n) {
//         // convert value to buffer
//         let buffer = toBuffer(value);
//         // if the most significant bit is 1, prepend a 0x00 byte to 
//         // indicate positive value
//         if (buffer[0] & 0x80) {
//             buffer = Buffer.concat([Buffer.alloc(1, 0x00), buffer])
//         }
//         // reverse endianess
//         return buffer.reverse();
//     } else {
//         // convert negative number to positive and create buffer 
//         let buffer = toBuffer(value * -1n);
//         // if the buffer has all the bits set, prepend an empty padding byte
//         buffer = allBitsSet(buffer)
//             ? Buffer.concat([Buffer.alloc(1, 0x00), buffer])
//             : buffer;
//         // invert the bits
//         const end = buffer.length;
//         let i = 0;
//         while (i < end) {
//             buffer[i] = buffer[i] ^ 0xff;
//             i++;
//         }
//         // Convert the updated buffer to a bigint, add one, 
//         // and convert back to buffer
//         let buffer2 = toBuffer(toBigInt(buffer) + 1n);
//         // if the most significant bit isn't 1, prepend a 0xff byte 
//         // to indicate negative value
//         if (!(buffer2[0] & 0x80)) {
//             buffer2 = Buffer.concat([Buffer.alloc(1, 0xff), buffer2])
//         }
//         // reverse endianess
//         return buffer2.reverse();
//     }
// }

export function asContractParamType(type: tsm.Type): sc.ContractParamType {

    if (type.isAny())
        return sc.ContractParamType.Any;
    if (isStringLike(type))
        return sc.ContractParamType.String;
    if (isBigIntLike(type) || isNumberLike(type))
        return sc.ContractParamType.Integer;
    if (isBooleanLike(type))
        return sc.ContractParamType.Boolean;

    const typeSymbol = type.getAliasSymbol() ?? type.getSymbol();
    const typeFQN = typeSymbol?.getFullyQualifiedName();

    switch (typeFQN) {
        case "global.ByteString": return sc.ContractParamType.ByteArray;
        case "global.Hash160": return sc.ContractParamType.Hash160;
        case "global.Hash256": return sc.ContractParamType.Hash256;
        case "global.ECPoint": return sc.ContractParamType.PublicKey;
        case "Iterator": return sc.ContractParamType.InteropInterface;
        case "Map": return sc.ContractParamType.Map;
        default: return sc.ContractParamType.Any;
    }
}

export function asReturnType(type: tsm.Type) {
    return isVoidLike(type)
        ? sc.ContractParamType.Void
        : asContractParamType(type);
}

export function getScratchFile(project: tsm.Project) {
    return project.getSourceFile("scratch.ts") || project.createSourceFile("scratch.ts");
}