import { sc } from "@cityofzion/neon-core";
import { num2VarInt } from "@cityofzion/neon-core/lib/u";
import { type } from "os";
import * as m from "ts-morph";
import { ContractType, ContractTypeKind, PrimitiveType, PrimitiveContractType, isPrimitive } from "./contractType";
import { ProjectContext, OperationContext, Instruction } from "./models";

const checkFlags = (type: m.Type, flags: m.ts.TypeFlags) => type.getFlags() & flags;
const isBigIntLike = (type: m.Type) => checkFlags(type, m.ts.TypeFlags.BigIntLike);
const isBooleanLike = (type: m.Type) => checkFlags(type, m.ts.TypeFlags.BooleanLike);
const isNumberLike = (type: m.Type) => checkFlags(type, m.ts.TypeFlags.NumberLike);
const isStringLike = (type: m.Type) => checkFlags(type, m.ts.TypeFlags.StringLike);

export function tsTypeToContractType(type: m.Type): ContractType {

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

export function convertProject(project: m.Project) {
    const ctx = new ProjectContext(project);
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(child => convertNode(child, ctx));
    }
    return ctx;
}

export function convertNode(node: m.Node, ctx: ProjectContext) {

    if (m.Node.isImportDeclaration(node)) {
        var module = node.getModuleSpecifierValue();
        if (module !== "@neo-project/neo-contract-framework") {
            throw new Error(`Unknown module ${module}`);
        }
    } else if (m.Node.isFunctionDeclaration(node)) {
        const op = convertFunction(node);
        ctx.operations.push(op);
    } else if (node.getKind() == m.SyntaxKind.EndOfFileToken) {
        // ignore EOF token
    } else {
        throw new Error(`${node.getKindName()} project node not implemented`)
    }
}

export function convertFunction(node: m.FunctionDeclaration) {
    const ctx = new OperationContext(node);
    ctx.instructions.push(...convertBody(node, ctx));
    const paramCount = node.getParameters().length;
    const localCount = 0;
    if (localCount > 0 || paramCount > 0) {
        ctx.instructions.unshift(new Instruction(sc.OpCode.INITSLOT, [localCount, paramCount]));
    }
    return ctx;
}

export function convertBody(node: m.BodyableNode, ctx: OperationContext): Instruction[] {
    const body = node.getBody();
    if (!body) return [];
    if (m.Node.isStatement(body)) {
        return convertStatement(body, ctx);
    }
    throw new Error(`${body.getKindName()} body node kind not implemented`)
}

function convertStatement(node: m.Statement, ctx: OperationContext): Instruction[] {
    switch (node.getKind()) {
        case m.SyntaxKind.Block: {
            const stmt = node.asKindOrThrow(m.SyntaxKind.Block);
            const ins = stmt
                .getStatements()
                .flatMap(s => convertStatement(s, ctx));
            return ins;
        }
        case m.SyntaxKind.ReturnStatement: {
            const stmt = node.asKindOrThrow(m.SyntaxKind.ReturnStatement);
            const expr = stmt.getExpression();
            const ins = convertExpression(expr, ctx);
            ins.push(new Instruction(sc.OpCode.RET));
            return ins;
        }
    }

    throw new Error(`convertStatement ${node.getKindName()} not implemented`);
}

function convertExpression(node: m.Expression | undefined, ctx: OperationContext): Instruction[] {
    if (!node) return [];

    const nodePrint = m.printNode(node.compilerNode);

    function isByteLiteral(n: m.Expression) {
        if (m.Node.isNumericLiteral(n)) {
            const value = n.getLiteralValue();
            return Number.isInteger(value) && value >= 0 && value <= 255;
        } else {
            return false;
        }
    }

    switch (node.getKind()) {
        case m.SyntaxKind.ArrayLiteralExpression: {
            const expr = node.asKindOrThrow(m.SyntaxKind.ArrayLiteralExpression);
            const elements = expr.getElements();
            // only converting arrays of byte literals right now
            if (elements.every(isByteLiteral)) {
                const bytes = elements.map(e => e.asKindOrThrow(m.ts.SyntaxKind.NumericLiteral).getLiteralValue());
                return [convertBuffer(Buffer.from(bytes)), new Instruction(sc.OpCode.CONVERT, [sc.StackItemType.Buffer])];

            }
            console.log();
        }
        case m.SyntaxKind.AsExpression: {
            const expr = node.asKindOrThrow(m.SyntaxKind.AsExpression);
            const ins = convertExpression(expr.getExpression(), ctx);
            const type = tsTypeToContractType(expr.getType());
            if (isPrimitive(type)) {
                if (type.type === PrimitiveType.Integer) {
                    ins.push(new Instruction(sc.OpCode.CONVERT, [sc.StackItemType.Integer]))
                } else {
                    throw new Error(`asExpression ${PrimitiveType[type.type]} primitive not implemented`)
                }
            } else {
                throw new Error(`asExpression ${ContractTypeKind[type.kind]} kind not implemented`)
            }
            return ins;
        }
        case m.SyntaxKind.BinaryExpression: {
            const expr = node.asKindOrThrow(m.SyntaxKind.BinaryExpression);
            const left = convertExpression(expr.getLeft(), ctx);
            const right = convertExpression(expr.getRight(), ctx);
            const op = convertBinaryOperator(expr);
            return [...left, ...right, ...op];
        }
        case m.SyntaxKind.CallExpression: {
            const expr = node.asKindOrThrow(m.SyntaxKind.CallExpression);
            const ins: Instruction[] = [];
            for (const arg of expr.getArguments().reverse()) {
                const t = m.printNode(arg.compilerNode);
                if (m.Node.isExpression(arg)) {
                    ins.push(...convertExpression(arg, ctx));
                }
            }

            const t2 = m.printNode(expr.getExpression().compilerNode);
            ins.push(...convertExpression(expr.getExpression(), ctx));
            return ins;
        }
        case m.SyntaxKind.Identifier:
            return convertIdentifier(node.asKindOrThrow(m.SyntaxKind.Identifier), ctx);
        case m.SyntaxKind.NumericLiteral: {
            const literal = node.asKindOrThrow(m.SyntaxKind.NumericLiteral).getLiteralText();
            return [convertInt(BigInt(literal))]
        }
        case m.SyntaxKind.PropertyAccessExpression: {
            const expr = node.asKindOrThrow(m.SyntaxKind.PropertyAccessExpression);
            const e2 = expr.getExpression();
            const t2 = m.printNode(e2.compilerNode);
            convertExpression(e2, ctx);
            return [];
        }
        case m.SyntaxKind.StringLiteral: {
            const literal = node.asKindOrThrow(m.SyntaxKind.StringLiteral).getLiteralValue();
            var buffer = Buffer.from(literal, 'utf-8');
            return [convertBuffer(buffer)];
        }
    }

    throw new Error(`convertExpression ${node.getKindName()} not implemented`);
}

function convertIdentifier(node: m.Identifier, ctx: OperationContext): Instruction[] {
    const text1 = m.printNode(node.compilerNode);
    const defs = node.getDefinitions();
    for (const def of defs) {
        const defNode = def.getDeclarationNode();
        const text = m.printNode(defNode!.compilerNode);
        if (m.Node.isParameterDeclaration(defNode)) {
            const index = ctx.node.getParameters().findIndex(p => p === defNode);
            if (index === -1) throw new Error(`${defNode.getName()} param can't be found`);
            return [new Instruction(sc.OpCode.LDARG, [index])];
        } else if (m.Node.isNamespaceImport(defNode)) {
            const parent = defNode.getParent().asKindOrThrow(m.ts.SyntaxKind.ImportClause);
            // parent.getn
            console.log();
        }
        
        const msg = defNode ? `${defNode.getKindName()} identifier kind not implemented` : `defNode undefined`;
        throw new Error(msg)
    }

    throw new Error(`no definition found for ${node.getText()}`);
}

export function convertInt(i: BigInt): Instruction {
    if (i === -1n) { return new Instruction(sc.OpCode.PUSHM1) }
    if (i >= 0n && i <= 16n) {
        const opCode: sc.OpCode = sc.OpCode.PUSH0 + Number(i);
        return new Instruction(opCode);
    }
    const array = toByteArray(i);
    const opCode = getOpCode(array);
    return new Instruction(opCode, array);

    // convert JS BigInt to C# BigInt byte array encoding
    function toByteArray(i: BigInt) {
        if (i < 0n) { throw new Error("convertInt.toByteArray negative values not implemented") }

        let str = i.toString(16);
        if (str.length % 2 == 1) { str = '0' + str }
        const buffer = Buffer.from(str, 'hex').reverse();
        if (buffer.length == 0) throw new Error();

        let padding = buffer[buffer.length - 1] & 0x80 ? 1 : 0;
        const length = buffer.length + padding;
        for (const factor of [1,2,4,8,16,32]) {
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

export function convertBuffer(buffer: ArrayLike<number> & Iterable<number>) {

    const [opCode, length] = getOpCodeAndLength(buffer);
    const operand = new Uint8Array([...length, ...buffer]);
    return new Instruction(opCode, operand);

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

export function convertBinaryOperator(node: m.BinaryExpression) {
    const op = node.getOperatorToken();
    switch (op.getKind()) {
        case m.SyntaxKind.PlusToken: {
            const left = node.getLeft();
            const right = node.getRight();
            if (isStringType(left) && isStringType(right)) {
                return [new Instruction(sc.OpCode.CAT)]
            } else {
                throw new Error(`convertBinaryOperator.PlusToken not implemented for ${left.getType().getText()} and ${right.getType().getText()}`);
            }
        }
        default:
            throw new Error(`convertOperator ${op.getKindName()} not implemented`);
    }

    function isStringType(exp: m.Expression) {
        const flags = exp.getType().getFlags();
        return (flags & m.TypeFlags.String) || (flags & m.TypeFlags.StringLiteral);
    }
}

export function convertNEF(name: string, context: ProjectContext): [sc.NEF, sc.ContractManifest] {
    let fullScript = new Uint8Array(0);
    const methods = new Array<sc.ContractMethodDefinition>();
    for (const op of context.operations) {
        var method = toMethodDef(op.node, fullScript.length);
        if (method) { methods.push(method); }
        fullScript = new Uint8Array(Buffer.concat([fullScript, toScript(op.instructions)]));
    }

    const manifest = new sc.ContractManifest({
        name: name,
        abi: new sc.ContractAbi({ methods })
    });

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(fullScript).toString("hex"),
    })

    return [nef, manifest];

    function toScript(instructions: Instruction[]): Uint8Array {
        var buffer = Buffer.concat(instructions.map(i => i.toArray()));
        return new Uint8Array(buffer);
    }

    function toMethodDef(node: m.FunctionDeclaration, offset: number): sc.ContractMethodDefinition | undefined {

        if (!node.hasExportKeyword()) return undefined;
        return new sc.ContractMethodDefinition({
            name: node.getNameOrThrow(),
            offset,
            parameters: node.getParameters().map(p => ({
                name: p.getName(),
                type: convertContractType(tsTypeToContractType(p.getType()))
            })),
            returnType: convertContractType(tsTypeToContractType(node.getReturnType()))
        });
    }
}

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
