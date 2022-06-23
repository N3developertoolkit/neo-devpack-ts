import { BinaryExpression, Block, Expression, FunctionDeclaration, Identifier, Node, ParameterDeclaration, Project, ReturnStatement, Statement, StringLiteral, SyntaxKind, ts, Type, TypeNode } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { BlockScope, FunctionScope, GlobalScope, ParameterSymbol, Scope, VariableSymbol } from "./common";

function printNode(node: Node, indent: number = 0) {
    console.log(`${new Array(indent + 1).join(' ')}${node.getKindName()}`);
    node.forEachChild(n => printNode(n, indent + 1));
}

class Instruction {
    constructor(
        readonly opCode: sc.OpCode,
        readonly node: Node,
        operand?: Uint8Array | Array<number>
    ) {
        /* TODO: ensure operand size matches expected size for opCode */
        this.operand = operand
            ? operand instanceof Uint8Array
                ? operand
                : Uint8Array.from(operand)
            : undefined;
    }

    readonly operand?: Uint8Array;

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

    toArray(): Uint8Array {
        var buffer = Buffer.concat(this.instructions.map(i => i.toArray()));
        return new Uint8Array(buffer);
    }
}

function buildSymbolTable(project: Project) {
    var globalScope = new GlobalScope();
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(child => processNode(child, globalScope));
    }
    return globalScope;

    function processNode(node: Node, scope: Scope) {
        const kind = node.getKindName();
        const name = Node.isNameable(node) ? node.getName() : "<notNameable>";
        if (Node.isFunctionDeclaration(node)) {
            const funcScope = scope.define(s => new FunctionScope(node, s));
            const params = node.getParameters() ?? [];
            for (let index = 0; index < params.length; index++) {
                funcScope.define(s => new ParameterSymbol(params[index], index, s))
            }
            node.forEachChild(child => processNode(child, funcScope));
        } else if (Node.isVariableDeclaration(node)) {
            scope.define(s => new VariableSymbol(node, s));
        } else if (Node.isBlock(node)) {
            // scope.define(s => new BlockScope(node, s));
        }
    }
}


function convertFunctionDecl(node: FunctionDeclaration, operations: Array<Operation>) {
    const instructions = new Array<Instruction>();
    const params = node.getParameters() ?? [];
    convertBody(node.getBodyOrThrow(), instructions);
    instructions.unshift(new Instruction(sc.OpCode.INITSLOT, node, [0, params.length]));
    operations.push(new Operation(node, instructions));
}

function convertBody(node: Node, instructions: Array<Instruction>) {
    if (Node.isStatement(node)) {
        convertStatement(node, instructions);
    } else {
        throw new Error(`convertBody ${node.getKindName()} not implemented`);
    }
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
        case SyntaxKind.BinaryExpression:
            const exp = node as BinaryExpression;
            convertExpression(exp.getLeft(), instructions);
            convertExpression(exp.getRight(), instructions);
            convertOperator(exp.getOperatorToken(), instructions);
            break;
        case SyntaxKind.Identifier:
            const exp2 = node as Identifier;
            const text = exp2.getText();
            const ancestors = exp2.getAncestors().filter(Node.isFunctionDeclaration);
            const index = ancestors[0].getParameters().findIndex(p => p.getName() === text);
            if (index >= 0) {
                instructions.push(new Instruction(sc.OpCode.LDARG, exp2, [index]));
            }
            
            // const defs = exp2.getDefinitionNodes();
            // const locals = exp2.getLocals();
            break;
        default:
            throw new Error(`convertExpression ${node.getKindName()} not implemented`);
    }
}

function convertOperator(node: Node<ts.BinaryOperatorToken>, instructions: Array<Instruction>) {
    switch (node.getKind()) {
        case SyntaxKind.PlusToken:
            instructions.push(new Instruction(sc.OpCode.ADD, node));
            break;
        default:
            throw new Error(`convertOperator ${node.getKindName()} not implemented`);
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

function convertType(type?: TypeNode<ts.TypeNode>): sc.ContractParamType {
    if (!type) return sc.ContractParamType.Void;

    if (type.getKind() === SyntaxKind.StringKeyword) {
        return sc.ContractParamType.String;
    }

    throw new Error(`convertType for ${type.getText()} not implemented`);
}

function convertParameter(param: ParameterDeclaration): sc.ContractParameterDefinition {
    return {
        name: param.getName(),
        type: convertType(param.getTypeNodeOrThrow())
    }
}

function convertManifestMethod(operation: Operation, offset: number): sc.ContractMethodDefinition {
    return new sc.ContractMethodDefinition({
        name: operation.node.getNameOrThrow(),
        offset,
        parameters: operation.node.getParameters().map(convertParameter),
        returnType: convertType(operation.node.getReturnTypeNode())
    });
}

function convertNEF(name: string, operations: Array<Operation>): [sc.NEF, sc.ContractManifest] {
    const methods = new Array<sc.ContractMethodDefinition>();
    let fullScript = new Uint8Array(0);
    for (const op of operations) {
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








const contractSource = /*javascript*/`
// import * as neo from '@neo-project/neo-contract-framework';
// export function helloWorld(): string { return "Hello, World!"; }
export function sayHello(name: string): string { 
    const foo = "bar";
    return "Hello, " + name + "!";
}
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

var table = buildSymbolTable(project);
console.log();
// const functions = convertProject(project);
// const operations = new Array<Operation>();
// for (const f of functions) {
//     convertFunctionDecl(f, operations);
// }

// const [nef, manifest] = convertNEF("test-contract", operations);
// const json = { nef: nef.toJson(), manifest: manifest.toJson() }
// console.log(JSON.stringify(json, null, 4));




