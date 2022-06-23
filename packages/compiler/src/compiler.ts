import { BinaryExpression, Block, Expression, FunctionDeclaration, Node, ParameterDeclaration, Project, ReturnStatement, Statement, StringLiteral, SyntaxKind, ts, Type } from "ts-morph";
import { sc } from "@cityofzion/neon-core";

function printNode(node: Node, indent: number = 0) {
    console.log(`${new Array(indent + 1).join(' ')}${node.getKindName()}`);
    node.forEachChild(n => printNode(n, indent + 1));
}

const contractSource = /*javascript*/`
import * as neo from '@neo-project/neo-contract-framework';
export function helloWorld(name:string) { return "Hello, World!"; }
`;

const project = new Project();
project.createSourceFile("contract.ts", contractSource);

// var diagnostics = project.getPreEmitDiagnostics();
// if (diagnostics.length > 0) {
//     for (const diagnostic of diagnostics) {
//         const message = diagnostic.getMessageText();
//         console.log(message);

//         const file = diagnostic.getSourceFile();
//         if (!file) continue;
//         let diagPosition = file.getBaseName();
//         const start = diagnostic.getStart()
//         if (!start) continue;
//         const lineAndChar = file.getLineAndColumnAtPos(start);
//         diagPosition += `:${lineAndChar.line + 1}:${lineAndChar.column + 1}`
//         console.log(diagPosition);
//     }
// };

const functions = new Array<FunctionDeclaration>();

for (const source of project.getSourceFiles()) {
    if (source.isDeclarationFile()) continue;
    source.forEachChild(node => {
        if (Node.isImportDeclaration(node)) {
            var module = node.getModuleSpecifierValue();
            if (module !== "@neo-project/neo-contract-framework") {
                throw new Error(`Unknown module ${module}`);
            }
        } else if (Node.isFunctionDeclaration(node)) {
            functions.push(node);
        } else if (node.getKind() == SyntaxKind.EndOfFileToken) {
            // ignore
        } else {
            throw new Error(`${node.getKindName()} not supported`);
        }
    })
}

class Instruction {
    constructor(
        readonly opCode: sc.OpCode,
        readonly node: Node,
        readonly operand?: Uint8Array
    ) { /* TODO: ensure operand size matches expected size for opCode */ }

    toArray(): Uint8Array {
        const array = this.operand
            ? new Uint8Array(this.operand.length + 1)
            : new Uint8Array(1);
        array[0] = this.opCode;
        if (this.operand) {
            array.set(this.operand, 1);
        }
        return array;
    }
}

class Operation {
    constructor(readonly node: FunctionDeclaration, readonly instructions: Array<Instruction>) { }

    getName() { return this.node.getNameOrThrow(); }
    getIsPublic() { return this.node.hasExportKeyword(); }
    getReturnType() { return this.node.getReturnType() }

    toArray(): Uint8Array {
        var buffer = Buffer.concat(this.instructions.map(i => i.toArray()));
        return new Uint8Array(buffer);
    }
}

const operations = new Array<Operation>();

for (const f of functions) {
    const instructions = convertBody(f.getBodyOrThrow());
    operations.push(new Operation(f, instructions));
}

function convertBody(node: Node) {
    const instructions = new Array<Instruction>();
    if (Node.isStatement(node)) {
        convertStatement(node, instructions);
    } else {
        throw new Error(`convertBody ${node.getKindName()} not implemented`);
    }
    return instructions;
}

function convertStatement(node: Statement, instructions: Array<Instruction>) {
    switch (node.getKind()) {
        case SyntaxKind.Block:
            const openBrace = node.getFirstChildByKind(SyntaxKind.OpenBraceToken);
            if (openBrace) instructions.push(new Instruction(sc.OpCode.NOP, openBrace));
            for (const stmt of (node as Block).getStatements()) {
                convertStatement(stmt, instructions);
            }
            const closeBrace = node.getLastChildByKind(SyntaxKind.CloseBraceToken);
            if (closeBrace) instructions.push(new Instruction(sc.OpCode.NOP, closeBrace));
            break;
        case SyntaxKind.ReturnStatement:
            const exp = (node as ReturnStatement).getExpression();
            convertExpression(exp, instructions);
            instructions.push(new Instruction(sc.OpCode.RET, node));
            break;
        default:
            throw new Error(`convertStatement ${node.getKindName()} not implemented`);
    }
}

function convertExpression(node: Expression | undefined, instructions: Array<Instruction>) {
    if (!node) return;

    switch (node.getKind()) {
        case SyntaxKind.StringLiteral:
            const literal = (node as StringLiteral).getLiteralValue();
            var buffer = Buffer.from(literal, 'utf-8');
            instructions.push(convertBuffer(buffer, node));
            break;
        default:
            throw new Error(`convertExpression ${node.getKindName()} not implemented`);
    }
}

function convertBuffer(buffer: Buffer, node: Node) {

    if (buffer.length <= 255) {
        const operand = new Uint8Array(buffer.length + 1);
        operand[0] = buffer.length;
        buffer.copy(operand, 1);
        return new Instruction(sc.OpCode.PUSHDATA1, node, operand);
    }

    throw new Error(`convertBuffer for length ${buffer.length} not implemented`);
}

function convertType(type: Type<ts.Type>): sc.ContractParamType {
    if (type.isString()) {
        return sc.ContractParamType.String;
    }
    
    throw new Error(`convertType for ${type.getText()} not implemented`);
}

function convertParameter(param: ParameterDeclaration): sc.ContractParameterDefinition {
    return {
        name: param.getName(),
        type: convertType(param.getType())
    }
}

function convertManifestMethod(operation: Operation, offset: number): sc.ContractMethodDefinition {
    return new sc.ContractMethodDefinition({
        name: operation.node.getNameOrThrow(),
        offset,
        parameters: operation.node.getParameters().map(convertParameter),
        returnType: convertType(operation.node.getReturnType())
    });
}

function convertNEF(name: string, operations: Array<Operation>): [sc.NEF, sc.ContractManifest] {
    const methods = new Array<sc.ContractMethodDefinition>();
    let fullScript = new Uint8Array(0);
    for (const op of operations)
    {
        if (op.node.hasExportKeyword()) {
            methods.push(convertManifestMethod(op, fullScript.length));
        }

        const buffer = Buffer.concat([fullScript, op.toArray()]);
        fullScript = new Uint8Array(buffer);
    }

    const manifest = new sc.ContractManifest({
        name: name,
        abi: new sc.ContractAbi({ methods })
    });

    const nef = new sc.NEF({
        compiler: "neo-devpack-ts",
        script: Buffer.from(fullScript).toString("base64"),
    })

    return [nef, manifest];
}

const [nef, manifest] = convertNEF("test-contract", operations);
const json = { nef, manifest }
console.log(JSON.stringify(json, null, 4));

