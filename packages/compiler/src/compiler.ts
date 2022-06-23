import { BinaryExpression, Block, Expression, FunctionDeclaration, Identifier, Node, ParameterDeclaration, Project, ReturnStatement, Statement, StringLiteral, SyntaxKind, ts, Type, TypeNode } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { FunctionScope, GlobalScope, ParameterSymbol, Scope } from "./common";

function printNode(node: Node, indent: number = 0) {
    console.log(`${new Array(indent + 1).join(' ')}${node.getKindName()}`);
    node.forEachChild(n => printNode(n, indent + 1));
}

function printProject(project: Project) {
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(child => printNode(child, 0));
    }
}

class Instruction {
    readonly operand?: Uint8Array;

    constructor(
        readonly opCode: sc.OpCode,
        readonly node: Node,
        operand?: Uint8Array | Iterable<number>
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

class Operation {
    constructor(
        readonly node: FunctionDeclaration, 
        readonly instructions: Array<Instruction>
    ) { }

    get isPublic() { return this.node.hasExportKeyword(); }

    toScript(): Uint8Array {
        var buffer = Buffer.concat(this.instructions.map(i => i.toArray()));
        return new Uint8Array(buffer);
    }

    toMethodDef(offset: number): sc.ContractMethodDefinition | undefined {
        return this.isPublic
            ? new sc.ContractMethodDefinition({
                    name: this.node.getNameOrThrow(),
                    offset,
                    parameters: this.node.getParameters().map(convertParam),
                    returnType: convertType(this.node.getReturnTypeNode())
                })
            : undefined;

        function convertParam(p: ParameterDeclaration): sc.ContractParameterDefinition {
            return {
                name: p.getName(),
                type: convertType(p.getTypeNodeOrThrow())
            };
        }
    }
}

function buildSymbolTable(project: Project): Scope {
    var globalScope = new GlobalScope();
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(child => processNode(child, globalScope));
    }
    return globalScope;

    function processNode(node: Node, scope: Scope) {
        if (Node.isFunctionDeclaration(node)) {
            const funcScope = new FunctionScope(node, scope);
            scope.define(funcScope);
            funcScope.defineParameters(node.getParameters());
            scope = funcScope;
        }

        node.forEachChild(child => processNode(child, scope));
    }
}

function convertProject(project: Project, scope: Scope) {
    const operations = new Array<Operation>();
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(node => {
            if (Node.isImportDeclaration(node)) {
                var module = node.getModuleSpecifierValue();
                if (module !== "@neo-project/neo-contract-framework") {
                    throw new Error(`Unknown module ${module}`);
                }
            } else if (Node.isFunctionDeclaration(node)) {
                const newScope = scope.resolve(node.getNameOrThrow());
                if (newScope instanceof FunctionScope) {
                    const op = convertFunction(node, newScope);
                    operations.push(op);
                }
            } else if (node.getKind() == SyntaxKind.EndOfFileToken) {
                // ignore
            } else {
                throw new Error(`${node.getKindName()} not supported`);
            }
        })
    }
    return operations;
}

function convertFunction(node: FunctionDeclaration, scope: Scope) {
    const params = node.getParameters() ?? [];
    const instructions = convertBody(node.getBodyOrThrow(), scope);
    instructions.unshift(new Instruction(sc.OpCode.INITSLOT, node, [0, params.length]));
    return new Operation(node, instructions);
}

function convertBody(node: Node, scope: Scope) {
    if (Node.isStatement(node)) {
        return convertStatement(node, scope);
    }

    throw new Error(`convertBody ${node.getKindName()} not implemented`);
}

function convertStatement(node: Statement, scope: Scope): Instruction[] {
    switch (node.getKind()) {
        case SyntaxKind.Block:
            const ins1 = (node as Block).getStatements().flatMap(s => convertStatement(s, scope));
            const openBrace = node.getFirstChildByKind(SyntaxKind.OpenBraceToken);
            if (openBrace) ins1.unshift(new Instruction(sc.OpCode.NOP, openBrace));
            const closeBrace = node.getLastChildByKind(SyntaxKind.CloseBraceToken);
            if (closeBrace) ins1.push(new Instruction(sc.OpCode.NOP, closeBrace));
            return ins1;
        case SyntaxKind.ReturnStatement:
            const exp = (node as ReturnStatement).getExpression();
            const ins2 = convertExpression(exp, scope);
            ins2.push(new Instruction(sc.OpCode.RET, node));
            return ins2;
    }

    throw new Error(`convertStatement ${node.getKindName()} not implemented`);
}

function convertExpression(node: Expression | undefined, scope: Scope): Instruction[] {
    if (!node) return [];

    switch (node.getKind()) {
        case SyntaxKind.StringLiteral:
            const literal = (node as StringLiteral).getLiteralValue();
            var buffer = Buffer.from(literal, 'utf-8');
            return [convertBuffer(buffer, node)];
        case SyntaxKind.BinaryExpression:
            const bin = node as BinaryExpression;
            const left = convertExpression(bin.getLeft(), scope);
            const right = convertExpression(bin.getRight(), scope);
            const op = convertOperator(bin.getOperatorToken());
            return [...left, ...right, op];
        case SyntaxKind.Identifier:
            const id = (node as Identifier).getText();
            const symbol = scope.resolve(id);
            if (!symbol) throw new Error(`Failed to resolve ${id}`);
            if (symbol instanceof ParameterSymbol) {
                return [new Instruction(sc.OpCode.LDARG, node, [symbol.index])];
            }
            break;
    }

    throw new Error(`convertExpression ${node.getKindName()} not implemented`);
}

function convertOperator(node: Node<ts.BinaryOperatorToken>) {
    switch (node.getKind()) {
        case SyntaxKind.PlusToken:
            return new Instruction(sc.OpCode.ADD, node);
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

    const prj = type.getProject();
    const checker = prj.getTypeChecker();
    const foo = checker.getApparentType(type.getType())
    var ct = foo.compilerType;
    var isStr = foo.isString();
    if (type.getKind() === SyntaxKind.StringKeyword) {
        return sc.ContractParamType.String;
    }

    throw new Error(`convertType for ${type.getText()} not implemented`);
}

function convertNEF(name: string, operations: Array<Operation>): [sc.NEF, sc.ContractManifest] {
    let fullScript = new Uint8Array(0);
    const methods = new Array<sc.ContractMethodDefinition>();
    for (const op of operations) {
        var method = op.toMethodDef(fullScript.length);
        if (method) { methods.push(method); }
        const buffer = Buffer.concat([fullScript, op.toScript()]);
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
import * as neo from '@neo-project/neo-contract-framework';
export function helloWorld(): string { return "Hello, World!"; }
export function sayHello(name: string): string { return "Hello, " + name + "!"; }
`;


const project = new Project();
project.createSourceFile("contract.ts", contractSource);

console.time('getPreEmitDiagnostics');
var diagnostics = project.getPreEmitDiagnostics();
console.timeEnd('getPreEmitDiagnostics')

if (diagnostics.length > 0) {
    diagnostics.forEach(d => console.log(d.getMessageText()));
    process.exit(-1);
} 

const table = buildSymbolTable(project);
const operations = convertProject(project, table);
const [nef, manifest] = convertNEF("test-contract", operations);
const json = { nef: nef.toJson(), manifest: manifest.toJson() }
console.log(JSON.stringify(json, null, 4));
