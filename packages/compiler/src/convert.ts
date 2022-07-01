import { sc } from "@cityofzion/neon-core";
import * as m from "ts-morph";
import { ContractType, ContractTypeKind, PrimitiveType, PrimitiveContractType } from "./contractType";
import { ProjectContext, OperationContext, Instruction } from "./models";

export function convertType(type: m.Type): ContractType {

    if (type.isString()) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.String,
    } as PrimitiveContractType;

    throw new Error(`${type.getText()} not implemented`);
}

export function toContractParamType(type: ContractType): sc.ContractParamType {
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

export function convertProject(project: m.Project) {
    const ctx = new ProjectContext(project);
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(child => convertProjectNode(child, ctx));
    }
    return ctx;
}

export function convertProjectNode(node: m.Node, ctx: ProjectContext) {

    if (m.Node.isImportDeclaration(node)) {
        var module = node.getModuleSpecifierValue();
        if (module !== "@neo-project/neo-contract-framework") {
            throw new Error(`Unknown module ${module}`);
        }
    } else if (m.Node.isFunctionDeclaration(node)) {
        const op = convertFunction(node);
        ctx.operations.push(op);
    } else if (node.getKind() == m.SyntaxKind.EndOfFileToken) {
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
            const ins = node.asKindOrThrow(m.SyntaxKind.Block)
                .getStatements()
                .flatMap(s => convertStatement(s, ctx));
            // const openBrace = node.getFirstChildByKind(SyntaxKind.OpenBraceToken);
            // if (openBrace) { ins.unshift(new SequencePoint(openBrace), new Instruction(sc.OpCode.NOP)); }
            // const closeBrace = node.getLastChildByKind(SyntaxKind.CloseBraceToken);
            // if (closeBrace) { ins.push(new SequencePoint(closeBrace), new Instruction(sc.OpCode.NOP)) ; }
            return ins;
        }
        case m.SyntaxKind.ReturnStatement: {
            const exp = node.asKindOrThrow(m.SyntaxKind.ReturnStatement).getExpression();
            const ins = convertExpression(exp, ctx);
            ins.push(new Instruction(sc.OpCode.RET));
            return ins;
        }
    }

    throw new Error(`convertStatement ${node.getKindName()} not implemented`);
}

function convertExpression(node: m.Expression | undefined, ctx: OperationContext): Instruction[] {
    if (!node) return [];

    switch (node.getKind()) {
        case m.SyntaxKind.StringLiteral:
            const literal = node.asKindOrThrow(m.SyntaxKind.StringLiteral).getLiteralValue();
            var buffer = Buffer.from(literal, 'utf-8');
            return convertBuffer(buffer);
        case m.SyntaxKind.BinaryExpression:
            const bin = node.asKindOrThrow(m.SyntaxKind.BinaryExpression);
            const left = convertExpression(bin.getLeft(), ctx);
            const right = convertExpression(bin.getRight(), ctx);
            const op = convertBinaryOperator(bin);
            return [...left, ...right, ...op];
        case m.SyntaxKind.Identifier:
            return convertIdentifier(node.asKindOrThrow(m.SyntaxKind.Identifier), ctx);
    }

    throw new Error(`convertExpression ${node.getKindName()} not implemented`);
}

function convertIdentifier(node: m.Identifier, ctx: OperationContext): Instruction[] {
    for (const def of node.getDefinitions()) {
        const defNode = def.getDeclarationNode();
        if (m.Node.isParameterDeclaration(defNode)) {
            const index = ctx.node.getParameters().findIndex(p => p === defNode);
            if (index === -1) throw new Error(`${defNode.getName()} param can't be found`);
            return [new Instruction(sc.OpCode.LDARG, [index])];
        }
        const msg = defNode ? `${defNode.getKindName()} identifier kind not implemented` : `defNode undefined`;
        throw new Error(msg)
    }

    throw new Error(`no definition found for ${node.getText()}`);
}

function convertNEF(name: string, context: ProjectContext): [sc.NEF, sc.ContractManifest] {
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
                type: toContractParamType(convertType(p.getType()))
            })),
            returnType: toContractParamType(convertType(node.getReturnType()))
        });
    }
}


export function convertBuffer(buffer: Buffer) {

    if (buffer.length <= 255) {
        const operand = new Uint8Array(buffer.length + 1);
        operand[0] = buffer.length;
        buffer.copy(operand, 1);
        return [new Instruction(sc.OpCode.PUSHDATA1, operand)];
    }

    throw new Error(`convertBuffer for length ${buffer.length} not implemented`);
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



