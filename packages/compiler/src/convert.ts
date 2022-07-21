import { sc, u } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { CompileContext, CompileError, OperationContext } from "./compiler";
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

// [SyntaxKind.CallExpression]: CallExpression;
function convertCallExpression(node: tsm.CallExpression, options: ConverterOptions) {

    const args = node.getArguments();
    for (let i = args.length - 1; i >= 0; i--) {
        const arg = args[i];
        if (tsm.Node.isExpression(arg)) {
            convertExpression(arg, options);
        } else {
            throw new CompileError(`Expected expression, got ${arg.getKindName()}`, arg);
        }
    }

    // TODO emit call
    convertExpression(node.getExpression(), options);
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
    const { context: { builtins },  op: { builder }} = options;

    const lhs = node.getExpression();
    const lhsSymbol = lhs.getSymbolOrThrow();
    const lhsTypeSymbol = builtins?.variables.get(lhsSymbol);
    if (!lhsTypeSymbol) { throw new CompileError(`could not resolve ${lhsSymbol.getName()}`, lhs); }
    const lhsInterface = builtins?.interfaces.get(lhsTypeSymbol);
    if (!lhsInterface) { throw new CompileError(`could not resolve ${lhsTypeSymbol.getName()}`, lhs); }

    const propertyNode = node.getNameNode();
    const propertySymbol = propertyNode.getSymbolOrThrow();
    const calls = lhsInterface.get(propertySymbol);
    if (!calls) { throw new CompileError(`could not resolve ${propertySymbol.getName()}`, propertyNode); }

    for (const call of calls) {
        const txt = Buffer.from(call.syscall, 'ascii').toString('hex');
        const buffer = Buffer.from(u.sha256(txt), 'hex').slice(0, 4);
        builder.push(sc.OpCode.SYSCALL, buffer);
    }
}

// [SyntaxKind.RegularExpressionLiteral]: RegularExpressionLiteral;
// [SyntaxKind.SpreadElement]: SpreadElement;
// [SyntaxKind.StringLiteral]: StringLiteral;
function convertStringLiteral(node: tsm.StringLiteral, options: ConverterOptions) {
    const { op: { builder }} = options;

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


export function convertInt(i: BigInt): Instruction {
    if (i === -1n) { return { opCode: sc.OpCode.PUSHM1 }; }
    if (i >= 0n && i <= 16n) {
        const opCode: sc.OpCode = sc.OpCode.PUSH0 + Number(i);
        return { opCode };
    }
    const operand = bigIntToByteArray(i);
    const opCode = getOpCode(operand);
    return { opCode, operand };

    function getOpCode(array: Uint8Array) {
        switch (array.length) {
            case 1: return sc.OpCode.PUSHINT8;
            case 2: return sc.OpCode.PUSHINT16;
            case 4: return sc.OpCode.PUSHINT32;
            case 8: return sc.OpCode.PUSHINT64;
            case 16: return sc.OpCode.PUSHINT128;
            case 32: return sc.OpCode.PUSHINT256;
            default: throw new Error(`Invalid integer buffer length ${array.length}`);
        }
    }
}

// convert JS BigInt to C# BigInt byte array encoding
function bigIntToByteArray(i: BigInt) {
    if (i < 0n) {
        throw new Error("convertInt.toByteArray negative values not implemented")
    }

    // convert big int to hex string
    let str = i.toString(16);
    // if odd length, prepend an extra zero padding
    if (str.length % 2 == 1) { str = '0' + str }
    // parse the hex string and reverse
    const buffer = Buffer.from(str, 'hex').reverse();
    if (buffer.length == 0) throw new Error("Invalid BigInt");

    // add padding
    let padding = buffer[buffer.length - 1] & 0x80 ? 1 : 0;
    const length = buffer.length + padding;
    for (const factor of [1, 2, 4, 8, 16, 32]) {
        if (length <= factor) {
            padding += factor - length;
            return padding === 0
                ? Uint8Array.from(buffer)
                : Uint8Array.from([
                    ...buffer,
                    ...(new Array<number>(padding).fill(0))
                ]);
        }
    }

    throw new Error(`${i} too big for NeoVM`);
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
