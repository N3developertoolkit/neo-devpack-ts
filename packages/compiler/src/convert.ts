import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { CompileError, OperationContext } from "./compiler";
import { ContractType, ContractTypeKind, PrimitiveType, PrimitiveContractType, isPrimitiveType } from "./contractType";
import { Instruction } from "./types";

const checkFlags = (type: tsm.Type, flags: tsm.ts.TypeFlags) => type.getFlags() & flags;
const isBigIntLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.BigIntLike);
const isBooleanLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.BooleanLike);
const isNumberLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.NumberLike);
const isStringLike = (type: tsm.Type) => checkFlags(type, tsm.ts.TypeFlags.StringLike);

export function tsTypeToContractType(type: tsm.Type): ContractType {

    if (isStringLike(type)) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.String,
    } as PrimitiveContractType;

    if (isBigIntLike(type) || isNumberLike(type)) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.Integer
    } as PrimitiveContractType;

    if (isBooleanLike(type)) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.Boolean
    } as PrimitiveContractType;

    throw new Error(`convertTypeScriptType ${type.getText()} not implemented`);
}

type ConvertFunction = (node: any, context: OperationContext) => void;

function dispatchConvert(node: tsm.Node, context: OperationContext, converters: Map<tsm.SyntaxKind, ConvertFunction>) {
    const nodePrint = tsm.printNode(node.compilerNode);
    const kind = node.getKind();
    const converter = converters.get(kind);
    if (!converter) {
        throw new CompileError(
            `dispatchConvert ${tsm.SyntaxKind[kind]} not implemented`,
            node);
    }
    converter(node.asKindOrThrow(kind), context);
}

export function convertStatement(node: tsm.Statement, context: OperationContext): void {

    tsm.ts.isIfStatement
    node.asKindOrThrow
    let map = new Map<tsm.SyntaxKind, ConvertFunction>([
        [tsm.SyntaxKind.Block, convertBlock],
        [tsm.SyntaxKind.ExpressionStatement, convertExpressionStatement],
        [tsm.SyntaxKind.ReturnStatement, convertReturnStatement]
    ]);
    dispatchConvert(node, context, map);
}

function convertBlock(node: tsm.Block, context: OperationContext) {
    node.getStatements().forEach(s => convertStatement(s, context));
}

function convertExpressionStatement(node: tsm.ExpressionStatement, context: OperationContext) {
    const expr = node.getExpression();
    if (!expr) { throw new CompileError(`falsy expression statement`, node); }
    convertExpression(expr, context);
}

function convertReturnStatement(node: tsm.ReturnStatement, context: OperationContext) {
    const expr = node.getExpression(); 
    if (expr) { convertExpression(expr, context); }
    context.instructions.push({opCode: sc.OpCode.RET});
}

function convertExpression(node: tsm.Expression, context: OperationContext) {

    let map = new Map<tsm.SyntaxKind, ConvertFunction>([
        [tsm.SyntaxKind.ArrayLiteralExpression, convertArrayLiteralExpression],
        // [tsm.SyntaxKind.AsExpression, convertAsExpression],
        // [tsm.SyntaxKind.BigIntLiteral, convertBigIntLiteral],
        [tsm.SyntaxKind.BinaryExpression, convertBinaryExpression],
        [tsm.SyntaxKind.CallExpression, convertCallExpression],
        [tsm.SyntaxKind.Identifier, convertIdentifier],
        // [tsm.SyntaxKind.NumericLiteral, convertNumericLiteral],
        [tsm.SyntaxKind.PropertyAccessExpression, convertPropertyAccessExpression],
        [tsm.SyntaxKind.StringLiteral, convertStringLiteral],
    ])

    dispatchConvert(node, context, map);
}

// [SyntaxKind.ArrayLiteralExpression]: ArrayLiteralExpression;
function convertArrayLiteralExpression(node: tsm.ArrayLiteralExpression): Instruction[] {

    const elements = node.getElements();

    // only converting arrays of byte literals right now
    if (elements.every(isByteLiteral)) {
        const bytes = elements
            .map(e => e.asKindOrThrow(tsm.ts.SyntaxKind.NumericLiteral).getLiteralValue());
        return [convertBuffer(Buffer.from(bytes)), { 
            opCode: sc.OpCode.CONVERT, 
            operand: Uint8Array.from([sc.StackItemType.Buffer])
        }];
    }

    throw new Error(`convertArrayLiteral not implemented`);

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
function convertBigIntLiteral(node: tsm.BigIntLiteral): Instruction[] {
    const literal = node.getLiteralText();
    return [convertInt(BigInt(literal))]
}

// [SyntaxKind.BinaryExpression]: BinaryExpression;
function convertBinaryExpression(node: tsm.BinaryExpression, ctx: OperationContext) {
    const left = node.getLeft();
    const right = node.getRight();
    const ins = convertBinaryOperator(
        node.getOperatorToken(),
        left.getType(),
        right.getType()
    );

    convertExpression(left, ctx);
    convertExpression(right, ctx);
    ctx.instructions.push(ins);

    function convertBinaryOperator(
        op: tsm.Node<tsm.ts.BinaryOperatorToken>, 
        left: tsm.Type, 
        right: tsm.Type
    ): Instruction {
        switch (op.getKind()) {
            case tsm.SyntaxKind.PlusToken: {
                if (isStringLike(left) && isStringLike(right)) {
                    return { opCode: sc.OpCode.CAT };
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
function convertCallExpression(node: tsm.CallExpression, ctx: OperationContext) {

    const args = node.getArguments();
    for (let i = args.length - 1; i >= 0; i--) {
        const arg = args[i];
        if (tsm.Node.isExpression(arg)) {
            convertExpression(arg, ctx);
        } else {
            throw new CompileError(`Expected expression, got ${arg.getKindName()}`, arg);
        }
    }

    // TODO emit call

//     const expr = node.getExpression();
//     const symbol = expr.getSymbolOrThrow();
//     const symbolDecl = symbol.getValueDeclarationOrThrow() as tsm.FunctionDeclaration;
//     const p = symbolDecl.getParent();
//     const q = symbolDecl.getStructure();


//     const symbolDeclText = tsm.printNode(symbolDecl.compilerNode);
//     const symbolFlags = symbol.getFlags();
//     const args = node.getArguments();

//     switch (symbolFlags) {
//         // case m.SymbolFlags.Function: {
//         //     break;
//         // }
//         default: throw new Error(`convertCallExpression ${tsm.SymbolFlags[symbolFlags]} not implemented`)
//     }

//     return [];

}

// [SyntaxKind.ClassExpression]: ClassExpression;
// [SyntaxKind.CommaListExpression]: CommaListExpression;
// [SyntaxKind.ConditionalExpression]: ConditionalExpression;
// [SyntaxKind.DeleteExpression]: DeleteExpression;
// [SyntaxKind.ElementAccessExpression]: ElementAccessExpression;
// [SyntaxKind.FunctionExpression]: FunctionExpression;
// [SyntaxKind.Identifier]: Identifier;
function convertIdentifier(node: tsm.Identifier, ctx: OperationContext) {

    // Not sure this is the best way to generally resolve identifiers,
    // but it works for parameters

    const defs = node.getDefinitions();
    if (defs.length !== 1) { throw new CompileError("Unexpected definitions", node); }
    const def = defs[0];
    switch (def.getKind()) {
        case tsm.ts.ScriptElementKind.parameterElement: {
            const declNode = def.getDeclarationNode();
            const index = ctx.node.getParameters().findIndex(p => p === declNode);
            if (index === -1) throw new CompileError(`${node.getText} param can't be found`, node);
            const ins: Instruction = {
                opCode: sc.OpCode.LDARG,
                operand: Uint8Array.from([index]),
            }
            ctx.instructions.push(ins);
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
function convertNumericLiteral(node: tsm.NumericLiteral): Instruction[] {
    const literal = node.getLiteralText();
    return [convertInt(BigInt(literal))]
}

// [SyntaxKind.ObjectLiteralExpression]: ObjectLiteralExpression;
// [SyntaxKind.OmittedExpression]: OmittedExpression;
// [SyntaxKind.ParenthesizedExpression]: ParenthesizedExpression;
// [SyntaxKind.PartiallyEmittedExpression]: PartiallyEmittedExpression;
// [SyntaxKind.PostfixUnaryExpression]: PostfixUnaryExpression;
// [SyntaxKind.PrefixUnaryExpression]: PrefixUnaryExpression;
// [SyntaxKind.PropertyAccessExpression]: PropertyAccessExpression;
function convertPropertyAccessExpression(node: tsm.PropertyAccessExpression, ctx: OperationContext) {
    const builtins = ctx.parent.builtins;

    const lhs = node.getExpression();
    const lhsSymbol = lhs.getSymbolOrThrow();
    const lhsBuiltIn = builtins?.variables.get(lhsSymbol);
    
    const propertyNode = node.getNameNode();
    const propertySymbol = propertyNode.getSymbolOrThrow();

    const lhsSymbolDecl = lhsSymbol.getValueDeclarationOrThrow();
    const propertyName = node.getName();

    console.log();
    
    
//     const id = node.getSourceFile().getImportDeclaration(w => true);
//     const nodeType = node.getType();
//     const nodeTypeText = nodeType.getText();

//     
//     const lhsText = tsm.printNode(lhs.compilerNode);
//     const lhsType = lhs.getType();
//     
//     const foo = tsm.printNode(lhsSymbol.getValueDeclarationOrThrow().compilerNode)
//     const lhsSymbolDecl = lhsSymbol.getDeclarations()[0];

//     

//     convertExpression(lhs, ctx);
//     return [];
}

// [SyntaxKind.RegularExpressionLiteral]: RegularExpressionLiteral;
// [SyntaxKind.SpreadElement]: SpreadElement;
// [SyntaxKind.StringLiteral]: StringLiteral;
function convertStringLiteral(node: tsm.StringLiteral, ctx: OperationContext) {
    const literal = node.getLiteralValue();
    const buffer = Buffer.from(literal, 'utf-8');
    const ins = convertBuffer(buffer);
    ctx.instructions.push(ins); 
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
    const operand = toByteArray(i);
    const opCode = getOpCode(operand);
    return { opCode, operand };

    // convert JS BigInt to C# BigInt byte array encoding
    function toByteArray(i: BigInt) {
        if (i < 0n) { 
            throw new Error("convertInt.toByteArray negative values not implemented") 
        }

        let str = i.toString(16);
        if (str.length % 2 == 1) { str = '0' + str }
        const buffer = Buffer.from(str, 'hex').reverse();
        if (buffer.length == 0) throw new Error();

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

export function convertBuffer(buffer: ArrayLike<number> & Iterable<number>):Instruction {

    const [opCode, length] = getOpCodeAndLength(buffer);
    const operand = new Uint8Array([...length, ...buffer]);
    return {opCode, operand};

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

// export function convertNEF(name: string, context: ProjectContext): [sc.NEF, sc.ContractManifest] {
//     let fullScript = new Uint8Array(0);
//     const methods = new Array<sc.ContractMethodDefinition>();
//     for (const op of context.operations) {
//         var method = toMethodDef(op.node, fullScript.length);
//         if (method) { methods.push(method); }
//         fullScript = new Uint8Array(Buffer.concat([fullScript, toScript(op.instructions)]));
//     }

//     const manifest = new sc.ContractManifest({
//         name: name,
//         abi: new sc.ContractAbi({ methods })
//     });

//     const nef = new sc.NEF({
//         compiler: "neo-devpack-ts",
//         script: Buffer.from(fullScript).toString("hex"),
//     })

//     return [nef, manifest];

//     function toScript(instructions: Instruction[]): Uint8Array {
//         var buffer = Buffer.concat(instructions.map(i => i.toArray()));
//         return new Uint8Array(buffer);
//     }

//     function toMethodDef(node: tsm.FunctionDeclaration, offset: number): sc.ContractMethodDefinition | undefined {

//         if (!node.hasExportKeyword()) return undefined;
//         return new sc.ContractMethodDefinition({
//             name: node.getNameOrThrow(),
//             offset,
//             parameters: node.getParameters().map(p => ({
//                 name: p.getName(),
//                 type: convertContractType(tsTypeToContractType(p.getType()))
//             })),
//             returnType: convertContractType(tsTypeToContractType(node.getReturnType()))
//         });
//     }
// }

export function convertContractType(type: ContractType): sc.ContractParamType {
    switch (type.kind) {
        case ContractTypeKind.Array: return sc.ContractParamType.Array;
        case ContractTypeKind.Interop: return sc.ContractParamType.InteropInterface;
        case ContractTypeKind.Map: return sc.ContractParamType.Map;
        case ContractTypeKind.Struct: return sc.ContractParamType.Array;
        case ContractTypeKind.Unspecified: return sc.ContractParamType.Any;
        case ContractTypeKind.Primitive: {
            const primitive = type as PrimitiveContractType;
            switch (primitive.type) {
                case PrimitiveType.Address: return sc.ContractParamType.Hash160;
                case PrimitiveType.Boolean: return sc.ContractParamType.Boolean;
                case PrimitiveType.ByteArray: return sc.ContractParamType.ByteArray;
                case PrimitiveType.Hash160: return sc.ContractParamType.Hash160;
                case PrimitiveType.Hash256: return sc.ContractParamType.Hash256;
                case PrimitiveType.Integer: return sc.ContractParamType.Integer;
                case PrimitiveType.PublicKey: return sc.ContractParamType.PublicKey;
                case PrimitiveType.Signature: return sc.ContractParamType.Signature;
                case PrimitiveType.String: return sc.ContractParamType.String;
                default: throw new Error(`Unrecognized PrimitiveType ${primitive.type}`);
            }
        }
        default: throw new Error(`Unrecognized ContractTypeKind ${type.kind}`);
    }
}
