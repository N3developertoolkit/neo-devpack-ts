import { BinaryExpression, Block, Expression, FunctionDeclaration, Identifier, Node, ParameterDeclaration, Project, ReturnStatement, Statement, StringLiteral, SyntaxKind, ts, Type } from "ts-morph";
import { sc } from "@cityofzion/neon-core";
import { GlobalScope, isSlotSymbol, Scope, SlotSymbol, SlotType, Symbol, SymbolMap } from "./common";
import * as fs from 'fs';
import * as path from 'path';
import { from } from "linq-to-typescript"

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
    get opCodeName() { return sc.OpCode[this.opCode]; }

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

class ProjectContext {
    readonly globalScope = new GlobalScope();
    readonly functions = new Array<FunctionDeclarationContext>();
}

class FunctionDeclarationContext implements Scope {

    readonly symbols = new SymbolMap();
    readonly instructions = new Array<Instruction>();

    get parameterCount() { return this.node.getParameters().length; }
    get scopeName() { return this.node.getNameOrThrow(); }

    constructor(
        readonly node: FunctionDeclaration,
        readonly parentScope: Scope
    ) {
        node.getParameters()
            .map((p, i) => new SlotSymbol(p, i, SlotType.Argument, this))
            .forEach(p => this.define(p));
    }
    define<T extends Symbol>(symbol: T): void { this.symbols.set(symbol); }
    getSymbols(): IterableIterator<Symbol> { return this.symbols.getSymbols(); }
    resolve(name: string): Symbol | undefined {  return this.symbols.resolve(name, this.parentScope); }

    toScript(): Uint8Array {
        var buffer = Buffer.concat(this.instructions.map(i => i.toArray()));
        return new Uint8Array(buffer);
    }

    toMethodDef(offset: number): sc.ContractMethodDefinition | undefined {

        return this.node.hasExportKeyword()
            ? new sc.ContractMethodDefinition({
                name: this.node.getNameOrThrow(),
                offset,
                parameters: this.node.getParameters().map(convertParam),
                returnType: convertType(this.node.getReturnType())
            })
            : undefined;

        function convertParam(p: ParameterDeclaration): sc.ContractParameterDefinition {
            return {
                name: p.getName(),
                type: convertType(p.getType())
            };
        }

        function convertType(type: Type): sc.ContractParamType {
            if (type.isString()) return sc.ContractParamType.String;
            throw new Error(`convertType not implemented for ${type.getText()}`);
        }
    }
}

function convertProject(project: Project) {
    const context = new ProjectContext()
    for (const source of project.getSourceFiles()) {
        if (source.isDeclarationFile()) continue;
        source.forEachChild(node => {
            if (Node.isImportDeclaration(node)) {
                var module = node.getModuleSpecifierValue();
                if (module !== "@neo-project/neo-contract-framework") {
                    throw new Error(`Unknown module ${module}`);
                }
            } else if (Node.isFunctionDeclaration(node)) {
                const opCtx = convertFunction(node, context.globalScope);
                context.functions.push(opCtx);
            } else if (node.getKind() == SyntaxKind.EndOfFileToken) {
                // ignore
            } else {
                throw new Error(`${node.getKindName()} not supported`);
            }
        })
    }
    return context;
}

function convertFunction(node: FunctionDeclaration, scope: Scope): FunctionDeclarationContext {
    var ctx = new FunctionDeclarationContext(node, scope);
    const instructions = convertBody(node.getBodyOrThrow(), ctx);

    const argCount = node.getParameters().length;
    const localCount = from(ctx.getSymbols())
        .where(s => isSlotSymbol(s) && s.type === SlotType.Local)
        .count();
    if (localCount > 0 || argCount > 0) {
        instructions.unshift(new Instruction(sc.OpCode.INITSLOT, node, [localCount, argCount]));
    }
    ctx.instructions.push(...instructions);
    return ctx;
}

function convertBody(node: Node, scope: Scope) {
    if (Node.isStatement(node)) {
        return convertStatement(node, scope);
    }

    throw new Error(`convertBody ${node.getKindName()} not implemented`);
}

function convertStatement(node: Statement, scope: Scope): Instruction[] {
    switch (node.getKind()) {
        case SyntaxKind.Block: {
            var ins = (node as Block).getStatements().flatMap(s => convertStatement(s, scope));
            const openBrace = node.getFirstChildByKind(SyntaxKind.OpenBraceToken);
            if (openBrace) { ins.unshift(new Instruction(sc.OpCode.NOP, openBrace)); }
            const closeBrace = node.getLastChildByKind(SyntaxKind.CloseBraceToken);
            if (closeBrace) ins.push(new Instruction(sc.OpCode.NOP, closeBrace));
            return ins;
        }
        case SyntaxKind.ReturnStatement: {
            const exp = (node as ReturnStatement).getExpression();
            const ins = convertExpression(exp, scope);
            ins.push(new Instruction(sc.OpCode.RET, node));
            return ins;
        }
    }

    throw new Error(`convertStatement ${node.getKindName()} not implemented`);
}

function getLoadOpcode(type: SlotType): sc.OpCode {
    switch (type) {
        case SlotType.Argument: return sc.OpCode.LDARG;
        case SlotType.Local: return sc.OpCode.LDLOC;
        case SlotType.Static: return sc.OpCode.LDSFLD;
        default: throw new Error(`getLoadOpcode ${SlotType[type]} not implemented`);
    }
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
            const op = convertBinaryOperator(bin);
            return [...left, ...right, op];
        case SyntaxKind.Identifier:
            const id = (node as Identifier).getText();
            const symbol = scope.resolve(id);
            if (!symbol) throw new Error(`convertExpression.Identifier Failed to resolve ${id}`);
            if (isSlotSymbol(symbol)) {
                const opCode = getLoadOpcode(symbol.type);
                return [new Instruction(opCode, node, [symbol.index])];
            } else {
                throw new Error(`convertExpression.Identifier non slot symbol not implemented`);
            }
    }

    throw new Error(`convertExpression ${node.getKindName()} not implemented`);
}

function convertBinaryOperator(node: BinaryExpression) {
    const op = node.getOperatorToken();
    switch (op.getKind()) {
        case SyntaxKind.PlusToken: {
            const left = node.getLeft();
            const right = node.getRight();
            if (isStringType(left) && isStringType(right)) {
                return new Instruction(sc.OpCode.CAT, node);
            } else {
                throw new Error(`convertBinaryOperator.PlusToken not implemented for ${left.getType().getText()} and ${right.getType().getText()}`);
            }
        }
        default:
            throw new Error(`convertOperator ${node.getKindName()} not implemented`);
    }

    function isStringType(exp: Expression) {
        const flags = exp.getType().getFlags();
        return (flags & ts.TypeFlags.String) || (flags & ts.TypeFlags.StringLiteral);
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

function convertNEF(name: string, context: ProjectContext): [sc.NEF, sc.ContractManifest] {
    let fullScript = new Uint8Array(0);
    const methods = new Array<sc.ContractMethodDefinition>();
    for (const op of context.functions) {
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
        script: Buffer.from(fullScript).toString("hex"),
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

// console.time('getPreEmitDiagnostics');
var diagnostics = project.getPreEmitDiagnostics();
// console.timeEnd('getPreEmitDiagnostics')

if (diagnostics.length > 0) {
    diagnostics.forEach(d => console.log(d.getMessageText()));
    process.exit(-1);
}

const context = convertProject(project);

const [nef, manifest] = convertNEF("test-contract", context);
const script = Buffer.from(nef.script, 'hex').toString('base64');
const json = { nef: nef.toJson(), manifest: manifest.toJson(), script }
console.log(JSON.stringify(json, null, 4));

const rootPath = path.join(path.dirname(__dirname), "test");
if (!fs.existsSync(rootPath)) { fs.mkdirSync(rootPath); }
const nefPath = path.join(rootPath, "contract.nef");
const manifestPath = path.join(rootPath, "contract.manifest.json");

fs.writeFileSync(nefPath, Buffer.from(nef.serialize(), 'hex'));
fs.writeFileSync(manifestPath, JSON.stringify(manifest.toJson(), null, 4));
console.log(`Contract NEF and Manifest written to ${rootPath}`);
