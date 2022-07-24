import { sc, u } from "@cityofzion/neon-core";
import { fromMethodName, InteropServiceCode } from "@cityofzion/neon-core/lib/sc";
import * as tsm from "ts-morph";
import { CallInfo, CallInfoKind, CompileContext, CompileError, isSysCallInfo, OperationContext } from "./compiler";
import { Instruction } from "./ScriptBuilder";
import { isStringLike } from "./utils";

export interface ConverterOptions {
    context: CompileContext,
    op: OperationContext,
};

type ConvertFunction<TNode extends tsm.Node> = (node: TNode, options: ConverterOptions) => void;
type ConvertFunctionAny = (node: any, options: ConverterOptions) => void;

function mapConverter<TKind extends tsm.ts.SyntaxKind>(
    kind: TKind,
    converter: ConvertFunction<tsm.KindToNodeMappings[TKind]>
): [tsm.ts.SyntaxKind, ConvertFunction<tsm.KindToNodeMappings[TKind]>] {
    return [kind, converter];
}

function dispatchConverter(node: tsm.Node, options: ConverterOptions, converters: Map<tsm.SyntaxKind, ConvertFunctionAny>) {
    // const nodePrint = tsm.printNode(node.compilerNode);
    const kind = node.getKind();
    const converter = converters.get(kind);
    if (!converter) {
        throw new CompileError(
            `dispatchConvert ${tsm.SyntaxKind[kind]} not implemented`,
            node);
    }
    converter(node.asKindOrThrow(kind), options);
}

export function convertStatement(node: tsm.Statement, options: ConverterOptions): void {
    dispatchConverter(node, options, new Map<tsm.SyntaxKind, ConvertFunctionAny>([
        mapConverter(tsm.SyntaxKind.Block, convertBlock),
        mapConverter(tsm.SyntaxKind.ExpressionStatement, convertExpressionStatement),
        mapConverter(tsm.SyntaxKind.ReturnStatement, convertReturnStatement)
    ]));
}

// case SyntaxKind.Block:
function convertBlock(node: tsm.Block, options: ConverterOptions) {
    const { op: { builder } } = options;
    builder.push(sc.OpCode.NOP)
        .set(node.getFirstChildByKind(tsm.ts.SyntaxKind.OpenBraceToken));
    node.getStatements()
        .forEach(s => convertStatement(s, options));
    builder.push(sc.OpCode.NOP)
        .set(node.getLastChildByKind(tsm.ts.SyntaxKind.CloseBraceToken));
}

// case SyntaxKind.BreakStatement:
// case SyntaxKind.ClassDeclaration:
// case SyntaxKind.ContinueStatement:
// case SyntaxKind.DebuggerStatement:
// case SyntaxKind.DoStatement:
// case SyntaxKind.EmptyStatement:
// case SyntaxKind.EnumDeclaration:
// case SyntaxKind.ExportAssignment:
// case SyntaxKind.ExportDeclaration:
// case SyntaxKind.ExpressionStatement:
function convertExpressionStatement(node: tsm.ExpressionStatement, options: ConverterOptions) {
    const { op: { builder } } = options;
    const spSetter = builder.nodeSetter();
    const expr = node.getExpression();
    if (!expr) { throw new CompileError(`falsy expression statement`, node); }
    convertExpression(expr, options);
    spSetter.set(node);
}

// case SyntaxKind.ForInStatement:
// case SyntaxKind.ForOfStatement:
// case SyntaxKind.ForStatement:
// case SyntaxKind.FunctionDeclaration:
// case SyntaxKind.IfStatement:
// case SyntaxKind.ImportDeclaration:
// case SyntaxKind.ImportEqualsDeclaration:
// case SyntaxKind.InterfaceDeclaration:
// case SyntaxKind.LabeledStatement:
// case SyntaxKind.ModuleBlock:
// case SyntaxKind.ModuleDeclaration:
// case SyntaxKind.NotEmittedStatement:
// case SyntaxKind.ReturnStatement:
function convertReturnStatement(node: tsm.ReturnStatement, options: ConverterOptions) {
    const { op: { builder, returnTarget } } = options;
    const spSetter = builder.nodeSetter();
    const expr = node.getExpression();
    if (expr) { convertExpression(expr, options); }
    builder.pushTarget(sc.OpCode.JMP_L, returnTarget);
    spSetter.set(node);
}

// case SyntaxKind.SwitchStatement:
// case SyntaxKind.ThrowStatement:
// case SyntaxKind.TryStatement:
// case SyntaxKind.TypeAliasDeclaration:
// case SyntaxKind.VariableStatement:
// case SyntaxKind.WhileStatement:
// case SyntaxKind.WithStatement:

function convertExpression(node: tsm.Expression, options: ConverterOptions) {

    dispatchConverter(node, options, new Map<tsm.SyntaxKind, ConvertFunctionAny>([
        mapConverter(tsm.SyntaxKind.ArrayLiteralExpression, convertArrayLiteralExpression),
        // [tsm.SyntaxKind.AsExpression, convertAsExpression],
        // [tsm.SyntaxKind.BigIntLiteral, convertBigIntLiteral],
        mapConverter(tsm.SyntaxKind.BinaryExpression, convertBinaryExpression),
        mapConverter(tsm.SyntaxKind.CallExpression, convertCallExpression),
        mapConverter(tsm.SyntaxKind.Identifier, convertIdentifier),
        mapConverter(tsm.SyntaxKind.NumericLiteral, convertNumericLiteral),
        mapConverter(tsm.SyntaxKind.PropertyAccessExpression, convertPropertyAccessExpression),
        mapConverter(tsm.SyntaxKind.StringLiteral, convertStringLiteral),
    ]));
}

// [SyntaxKind.ArrayLiteralExpression]: ArrayLiteralExpression;
function convertArrayLiteralExpression(node: tsm.ArrayLiteralExpression, options: ConverterOptions) {
    const { op: { builder } } = options;

    const elements = node.getElements();

    // only converting arrays of byte literals right now
    if (elements.every(isByteLiteral)) {
        const bytes = elements
            .map(e => e.asKindOrThrow(tsm.ts.SyntaxKind.NumericLiteral).getLiteralValue());
        builder.push(convertBuffer(Buffer.from(bytes)));
        builder.push(sc.OpCode.CONVERT, [sc.StackItemType.Buffer])
        return;
    }

    throw new CompileError(`convertArrayLiteral not implemented`, node);

    function isByteLiteral(n: tsm.Expression) {
        if (tsm.Node.isNumericLiteral(n)) {
            const value = n.getLiteralValue();
            return Number.isInteger(value) && value >= 0 && value <= 255;
        } else {
            return false;
        }
    }
}

// [SyntaxKind.ArrowFunction]: ArrowFunction;

// [SyntaxKind.AsExpression]: AsExpression;
// function convertAsExpression(node: tsm.AsExpression, ctx: OperationContext): Instruction[] {
//     const ins = convertExpression(node.getExpression(), ctx);
//     const type = tsTypeToContractType(node.getType());
//     if (isPrimitiveType(type)) {
//         if (type.type === PrimitiveType.Integer) {
//             ins.push({ 
//                 opCode: sc.OpCode.CONVERT, 
//                 operand: Uint8Array.from([sc.StackItemType.Integer])
//             });
//         } else {
//             throw new Error(`asExpression ${PrimitiveType[type.type]} primitive not implemented`)
//         }
//     } else {
//         throw new Error(`asExpression ${ContractTypeKind[type.kind]} kind not implemented`)
//     }
//     return ins;

// }

// [SyntaxKind.AwaitExpression]: AwaitExpression;

// [SyntaxKind.BigIntLiteral]: BigIntLiteral;
function convertBigIntLiteral(node: tsm.BigIntLiteral, options: ConverterOptions): Instruction[] {
    const literal = node.getLiteralText();
    return [convertInt(BigInt(literal))]
}

// [SyntaxKind.BinaryExpression]: BinaryExpression;
function convertBinaryExpression(node: tsm.BinaryExpression, options: ConverterOptions) {
    const { op: { builder } } = options;

    const left = node.getLeft();
    const right = node.getRight();
    const opCode = convertBinaryOperator(
        node.getOperatorToken(),
        left.getType(),
        right.getType()
    );

    convertExpression(left, options);
    convertExpression(right, options);
    builder.push(opCode);

    function convertBinaryOperator(
        op: tsm.Node<tsm.ts.BinaryOperatorToken>,
        left: tsm.Type,
        right: tsm.Type
    ): sc.OpCode {
        switch (op.getKind()) {
            case tsm.SyntaxKind.PlusToken: {
                if (isStringLike(left) && isStringLike(right)) {
                    return sc.OpCode.CAT;
                } else {
                    throw new Error(`convertBinaryOperator.PlusToken not implemented for ${left.getText()} and ${right.getText()}`);
                }
            }
            default:
                throw new Error(`convertOperator ${op.getKindName()} not implemented`);
        }
    }
}

function emitCall(calls: CallInfo[], args: tsm.Node[], options: ConverterOptions) {
    const { op: { builder } } = options;

    const argsLength = args.length;
    for (let i = argsLength - 1; i >= 0; i--) {
        const arg = args[i];
        if (tsm.Node.isExpression(arg)) {
            convertExpression(arg, options);
        } else {
            throw new CompileError(`Expected expression, got ${arg.getKindName()}`, arg);
        }
    }

    for (const call of calls) {
        if (isSysCallInfo(call)) {
            const buffer = Buffer.from(sc.generateInteropServiceCode(call.syscall), 'hex');
            builder.push(sc.OpCode.SYSCALL, buffer);
        } else {
            throw new Error(`Unexpected call info kind ${call.kind}`);
        }
    }
}

// [SyntaxKind.CallExpression]: CallExpression;
function convertCallExpression(node: tsm.CallExpression, options: ConverterOptions) {
    const { context: { builtins } } = options;

    const args = node.getArguments();
    const expr = node.getExpression();
    if (tsm.Node.isPropertyAccessExpression(expr)) {
        const symbol = expr.getNameNode().getSymbolOrThrow();
        const decl = symbol.getValueDeclarationOrThrow();
        if (!tsm.Node.isMethodSignature(decl)) throw new CompileError("unexpected value declaration", decl);
        const calls = symbol ? builtins?.symbols.get(symbol) : undefined;
        if (calls) {
            emitCall(calls, args, options);
            return;
        } 
    }
    
    throw new CompileError('convertCallExpression not implemented', expr);
}

// [SyntaxKind.ClassExpression]: ClassExpression;
// [SyntaxKind.CommaListExpression]: CommaListExpression;
// [SyntaxKind.ConditionalExpression]: ConditionalExpression;
// [SyntaxKind.DeleteExpression]: DeleteExpression;
// [SyntaxKind.ElementAccessExpression]: ElementAccessExpression;
// [SyntaxKind.FunctionExpression]: FunctionExpression;
// [SyntaxKind.Identifier]: Identifier;
function convertIdentifier(node: tsm.Identifier, options: ConverterOptions) {
    const { op } = options;


    // Not sure this is the best way to generally resolve identifiers,
    // but it works for parameters

    const defs = node.getDefinitions();
    if (defs.length !== 1) { throw new CompileError("Unexpected definitions", node); }
    const def = defs[0];
    switch (def.getKind()) {
        case tsm.ts.ScriptElementKind.parameterElement: {
            const declNode = def.getDeclarationNode();
            const index = op.node.getParameters().findIndex(p => p === declNode);
            if (index === -1) throw new CompileError(`${node.getText} param can't be found`, node);
            if (index <= 6) {
                op.builder.push(sc.OpCode.LDARG0 + index);
            } else {
                op.builder.push(sc.OpCode.LDARG, [index]);
            }
            break;
        }
        default:
            throw new CompileError("convertIdentifier not implemented", node);
    }
}

// [SyntaxKind.JsxClosingFragment]: JsxClosingFragment;
// [SyntaxKind.JsxElement]: JsxElement;
// [SyntaxKind.JsxExpression]: JsxExpression;
// [SyntaxKind.JsxFragment]: JsxFragment;
// [SyntaxKind.JsxOpeningElement]: JsxOpeningElement;
// [SyntaxKind.JsxOpeningFragment]: JsxOpeningFragment;
// [SyntaxKind.JsxSelfClosingElement]: JsxSelfClosingElement;
// [SyntaxKind.MetaProperty]: MetaProperty;
// [SyntaxKind.NewExpression]: NewExpression;
// [SyntaxKind.NonNullExpression]: NonNullExpression;
// [SyntaxKind.NoSubstitutionTemplateLiteral]: NoSubstitutionTemplateLiteral;
// [SyntaxKind.NumericLiteral]: NumericLiteral;
function convertNumericLiteral(node: tsm.NumericLiteral, options: ConverterOptions) {
    const { op: { builder } } = options;

    const literal = node.getLiteralText();
    builder.push(convertInt(BigInt(literal)));
}

// [SyntaxKind.ObjectLiteralExpression]: ObjectLiteralExpression;
// [SyntaxKind.OmittedExpression]: OmittedExpression;
// [SyntaxKind.ParenthesizedExpression]: ParenthesizedExpression;
// [SyntaxKind.PartiallyEmittedExpression]: PartiallyEmittedExpression;
// [SyntaxKind.PostfixUnaryExpression]: PostfixUnaryExpression;
// [SyntaxKind.PrefixUnaryExpression]: PrefixUnaryExpression;
// [SyntaxKind.PropertyAccessExpression]: PropertyAccessExpression;
function convertPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ConverterOptions) {
    const { context: { builtins }, op: { builder } } = options;

    const symbol = node.getNameNode().getSymbolOrThrow();
    const decl = symbol?.getValueDeclarationOrThrow();
    if (!tsm.Node.isPropertySignature(decl)) { throw new CompileError("Unexpected property", decl)}
    const calls = builtins?.symbols.get(symbol);
    if (calls) {
        emitCall(calls, [], options);
        return;
    } 
    
    throw new CompileError(`convertPropertyAccessExpression not implemented`, node);
}

// [SyntaxKind.RegularExpressionLiteral]: RegularExpressionLiteral;
// [SyntaxKind.SpreadElement]: SpreadElement;
// [SyntaxKind.StringLiteral]: StringLiteral;
function convertStringLiteral(node: tsm.StringLiteral, options: ConverterOptions) {
    const { op: { builder } } = options;

    const literal = node.getLiteralValue();
    const buffer = Buffer.from(literal, 'utf-8');
    builder.push(convertBuffer(buffer));
}

// [SyntaxKind.TaggedTemplateExpression]: TaggedTemplateExpression;
// [SyntaxKind.TemplateExpression]: TemplateExpression;
// [SyntaxKind.TypeAssertionExpression]: TypeAssertion;
// [SyntaxKind.TypeOfExpression]: TypeOfExpression;
// [SyntaxKind.YieldExpression]: YieldExpression;
// [SyntaxKind.AnyKeyword]: Expression;
// [SyntaxKind.BooleanKeyword]: Expression;
// [SyntaxKind.NumberKeyword]: Expression;
// [SyntaxKind.ObjectKeyword]: Expression;
// [SyntaxKind.StringKeyword]: Expression;
// [SyntaxKind.SymbolKeyword]: Expression;
// [SyntaxKind.UndefinedKeyword]: Expression;
// [SyntaxKind.FalseKeyword]: FalseLiteral;
// [SyntaxKind.ImportKeyword]: ImportExpression;
// [SyntaxKind.NullKeyword]: NullLiteral;
// [SyntaxKind.SuperKeyword]: SuperExpression;
// [SyntaxKind.ThisKeyword]: ThisExpression;
// [SyntaxKind.TrueKeyword]: TrueLiteral;
// [SyntaxKind.VoidExpression]: VoidExpression;


const pushIntSizes: ReadonlyArray<number> = [1, 2, 4, 8, 16, 32];

export function convertInt(i: bigint): Instruction {
    if (i === -1n) { return { opCode: sc.OpCode.PUSHM1 }; }
    if (i >= 0n && i <= 16n) {
        const opCode: sc.OpCode = sc.OpCode.PUSH0 + Number(i);
        return { opCode };
    }

    const buffer = bigIntToByteArray(i);
    const bufferLength = buffer.length;
    const sizesLength = pushIntSizes.length;
    for (let i = 0; i < sizesLength; i++) {
        const pushIntSize = pushIntSizes[i];
        if (bufferLength <= pushIntSize) {
            const padding = pushIntSize - bufferLength;
            const opCode = sc.OpCode.PUSHINT8 + i;
            const operand = padding == 0 
                ? buffer 
                : Uint8Array.from([...buffer, ...(new Array<number>(padding).fill(0))])
            return { opCode, operand };
        }
    }

    throw new Error(`Invalid integer buffer length ${buffer.length}`)
}

// convert JS BigInt to C# BigInt byte array encoding
export function bigIntToByteArray(i: bigint): Uint8Array {

    // convert big int to hex string
    let str = i < 0 ? (i * -1n).toString(16) : i.toString(16);
    // if odd length, prepend an extra zero padding
    if (str.length % 2 == 1) { str = '0' + str }
    let neonBigInt = u.BigInteger
        .fromHex(str)
        .mul(i < 0 ? -1 : 1);
    return Buffer.from(neonBigInt.toReverseTwos(), 'hex');
    // const length = buffer.length;
    // for (const factor of [1, 2, 4, 8, 16, 32]) {
    //     if (length <= factor) {
    //         const padding = factor - length;
    //         return padding === 0
    //             ? Uint8Array.from(buffer)
    //             : Uint8Array.from([
    //                 ...buffer,
    //                 ...(new Array<number>(padding).fill(0))
    //             ]);
    //     }
    // }

    // throw new Error(`${i} too big for NeoVM`);
}


export function convertBuffer(buffer: ArrayLike<number> & Iterable<number>): Instruction {

    const [opCode, length] = getOpCodeAndLength(buffer);
    const operand = new Uint8Array([...length, ...buffer]);
    return { opCode, operand };

    function getOpCodeAndLength(buffer: ArrayLike<number>): [sc.OpCode, Buffer] {
        if (buffer.length <= 255) /* byte.MaxValue */ {
            return [sc.OpCode.PUSHDATA1, Buffer.from([buffer.length])];
        }

        if (buffer.length <= 65535) /* ushort.MaxValue */ {
            const length = Buffer.alloc(2);
            length.writeUint16LE(buffer.length);
            return [sc.OpCode.PUSHDATA2, length];
        }

        if (buffer.length <= 4294967295) /* uint.MaxValue */ {
            const length = Buffer.alloc(4);
            length.writeUint32LE(buffer.length);
            return [sc.OpCode.PUSHDATA4, length];
        }

        throw new Error(`Buffer length ${buffer.length} too long`);
    }
}
