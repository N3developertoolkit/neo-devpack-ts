import { Node, FunctionDeclaration, Project, SyntaxKind, BodyableNode, Statement, Expression, Identifier, BinaryExpression, ts, ForEachDescendantTraversalControl, ParameterDeclaration, Type } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { ContractType, ContractTypeKind, isPrimitive, PrimitiveContractType, PrimitiveType } from "./common";
import path from "path";
import fs from 'fs';

class Instruction {
    readonly operand?: Uint8Array;
    get opCodeName() { return sc.OpCode[this.opCode]; }

    constructor(
        readonly opCode: sc.OpCode,
        operand?: Uint8Array | Iterable<number>,
    ) {
        // TODO: ensure operand size matches expected size for opCode 
        this.operand = operand
            ? operand instanceof Uint8Array
                ? operand
                : Uint8Array.from(operand)
            : undefined;
    }

    toArray(): Uint8Array {
        const length = this.operand ? this.operand.length + 1 : 1;
        const array = new Uint8Array(length);
        array[0] = this.opCode;
        if (this.operand) { array.set(this.operand, 1); }
        return array;
    }
}

class OperationContext {
    readonly instructions = new Array<Instruction>();
    constructor(readonly node: FunctionDeclaration) { }
}

class ProjectContext {
    readonly operations = new Array<OperationContext>();
    constructor(readonly project: Project) { }
}

function convertProject(project: Project) {
    const ctx = new ProjectContext(project);
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(child => convertProjectNode(child, ctx));
    }
    return ctx;
}

function convertProjectNode(node: Node, ctx: ProjectContext) {

    if (Node.isImportDeclaration(node)) {
        var module = node.getModuleSpecifierValue();
        if (module !== "@neo-project/neo-contract-framework") {
            throw new Error(`Unknown module ${module}`);
        }
    } else if (Node.isFunctionDeclaration(node)) {
        const op = convertFunction(node);
        ctx.operations.push(op);
    } else if (node.getKind() == SyntaxKind.EndOfFileToken) {
    } else {
        throw new Error(`${node.getKindName()} project node not implemented`)
    }
}

function convertFunction(node: FunctionDeclaration) {
    const ctx = new OperationContext(node);
    ctx.instructions.push(...convertBody(node, ctx));
    const paramCount = node.getParameters().length;
    const localCount = 0;
    if (localCount > 0 || paramCount > 0) {
        ctx.instructions.unshift(new Instruction(sc.OpCode.INITSLOT, [localCount, paramCount]));
    }
    return ctx;
}

function convertBody(node: BodyableNode, ctx: OperationContext): Instruction[] {
    const body = node.getBody();
    if (!body) return [];
    if (Node.isStatement(body)) {
        return convertStatement(body, ctx);
    }
    throw new Error(`${body.getKindName()} body node kind not implemented`)
}

function convertStatement(node: Statement, ctx: OperationContext): Instruction[] {
    switch (node.getKind()) {
        case SyntaxKind.Block: {
            const ins = node.asKindOrThrow(SyntaxKind.Block)
                .getStatements()
                .flatMap(s => convertStatement(s, ctx));
            // const openBrace = node.getFirstChildByKind(SyntaxKind.OpenBraceToken);
            // if (openBrace) { ins.unshift(new SequencePoint(openBrace), new Instruction(sc.OpCode.NOP)); }
            // const closeBrace = node.getLastChildByKind(SyntaxKind.CloseBraceToken);
            // if (closeBrace) { ins.push(new SequencePoint(closeBrace), new Instruction(sc.OpCode.NOP)) ; }
            return ins;
        }
        case SyntaxKind.ReturnStatement: {
            const exp = node.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
            const ins = convertExpression(exp, ctx);
            ins.push(new Instruction(sc.OpCode.RET));
            return ins;
        }
    }

    throw new Error(`convertStatement ${node.getKindName()} not implemented`);
}

function convertExpression(node: Expression | undefined, ctx: OperationContext): Instruction[] {
    if (!node) return [];

    switch (node.getKind()) {
        case SyntaxKind.StringLiteral:
            const literal = node.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
            var buffer = Buffer.from(literal, 'utf-8');
            return convertBuffer(buffer);
        case SyntaxKind.BinaryExpression:
            const bin = node.asKindOrThrow(SyntaxKind.BinaryExpression);
            const left = convertExpression(bin.getLeft(), ctx);
            const right = convertExpression(bin.getRight(), ctx);
            const op = convertBinaryOperator(bin);
            return [...left, ...right, ...op];
        case SyntaxKind.Identifier:
            return convertIdentifier(node.asKindOrThrow(SyntaxKind.Identifier), ctx);
    }

    throw new Error(`convertExpression ${node.getKindName()} not implemented`);
}

function convertIdentifier(node: Identifier, ctx: OperationContext): Instruction[] {
    for (const def of node.getDefinitions()) {
        const defNode = def.getDeclarationNode();
        if (Node.isParameterDeclaration(defNode)) {
            const index = ctx.node.getParameters().findIndex(p => p === defNode);
            if (index === -1) throw new Error(`${defNode.getName()} param can't be found`);
            return [new Instruction(sc.OpCode.LDARG, [index])];
        }
        const msg = defNode ? `${defNode.getKindName()} identifier kind not implemented` : `defNode undefined`;
        throw new Error(msg)
    }

    throw new Error(`no definition found for ${node.getText()}`);
}

function convertBinaryOperator(node: BinaryExpression) {
    const op = node.getOperatorToken();
    switch (op.getKind()) {
        case SyntaxKind.PlusToken: {
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

    function isStringType(exp: Expression) {
        const flags = exp.getType().getFlags();
        return (flags & ts.TypeFlags.String) || (flags & ts.TypeFlags.StringLiteral);
    }
}

function convertBuffer(buffer: Buffer) {

    if (buffer.length <= 255) {
        const operand = new Uint8Array(buffer.length + 1);
        operand[0] = buffer.length;
        buffer.copy(operand, 1);
        return [new Instruction(sc.OpCode.PUSHDATA1, operand)];
    }

    throw new Error(`convertBuffer for length ${buffer.length} not implemented`);
}

function convertType(type: Type): ContractType {

    if (type.isString()) return {
        kind: ContractTypeKind.Primitive,
        type: PrimitiveType.String,
    } as PrimitiveContractType;

    throw new Error(`${type.getText()} not implemented`);
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

    function toMethodDef(node: FunctionDeclaration, offset: number): sc.ContractMethodDefinition | undefined {

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

        function toContractParamType(type: ContractType): sc.ContractParamType {
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
    }
}









function dumpInstruction(ins: Instruction) {
    const operand = ins.operand ? Buffer.from(ins.operand).toString('hex') : "";
    console.log(`  ${sc.OpCode[ins.opCode]} ${operand}`);
}


function dumpOperation(op: OperationContext) {
    console.log(op.node.getName() ?? "<unknown>");
    op.instructions.forEach(dumpInstruction);
}

function dumpProject(prj: ProjectContext) {
    prj.operations.forEach(dumpOperation);
}




const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';
export function helloWorld(): string { return "Hello, World!"; }
export function sayHello(name: string): string { return "Hello, " + name + "!"; }
`;

const project = new Project({
    compilerOptions: {
        target: ts.ScriptTarget.ES5
    }
});
project.createSourceFile("contract.ts", contractSource);

// console.time('getPreEmitDiagnostics');
var diagnostics = project.getPreEmitDiagnostics();
// console.timeEnd('getPreEmitDiagnostics')

if (diagnostics.length > 0) {
    diagnostics.forEach(d => console.log(d.getMessageText()));
    process.exit(-1);
}

const prj = convertProject(project);
dumpProject(prj);

// const [nef, manifest] = convertNEF("test-contract", prj);
// const script = Buffer.from(nef.script, 'hex').toString('base64');
// const json = { nef: nef.toJson(), manifest: manifest.toJson(), script }
// console.log(JSON.stringify(json, null, 4));

// const rootPath = path.join(path.dirname(__dirname), "test");
// if (!fs.existsSync(rootPath)) { fs.mkdirSync(rootPath); }
// const nefPath = path.join(rootPath, "contract.nef");
// const manifestPath = path.join(rootPath, "contract.manifest.json");

// fs.writeFileSync(nefPath, Buffer.from(nef.serialize(), 'hex'));
// fs.writeFileSync(manifestPath, JSON.stringify(manifest.toJson(), null, 4));
// console.log(`Contract NEF and Manifest written to ${rootPath}`);
