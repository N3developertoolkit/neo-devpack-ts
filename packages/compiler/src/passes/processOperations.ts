import * as tsm from "ts-morph";
import { CompileContext, Scope, SymbolDefinition } from "../types/CompileContext";
import { CompileError } from "../compiler";
import { OperationBuilder, SlotType } from "../types/OperationBuilder";
import { OpCode } from "../types/OpCode";
import { BlockScope, FunctionSymbolDefinition, ParameterSymbolDefinition, VariableSymbolDefinition } from "../symbolTable";
import { dispatch } from "../utility/nodeDispatch";
import { JumpTarget } from "../types/Instruction";
import { getNumericLiteral, getSymbolOrCompileError, isBigIntLike, isStringLike } from "../utils";
import { ByteStringConstructor_from } from "../builtins";
import { StackItemType } from "../types/StackItem";

export type ProcessFunction = (node: tsm.Node, options: ProcessOptions) => void;

export interface ProcessOptions {
    builder: OperationBuilder,
    scope: Scope,
}

function processBlock(node: tsm.Block, options: ProcessOptions): void {
    const { builder, scope } = options;
    const blockOptions = {
        builder,
        scope: new BlockScope(node, scope),
    };
    builder.push(OpCode.NOP)
        .set(node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken));
    node.getStatements()
        .forEach(s => processStatement(s, blockOptions));
    builder.push(OpCode.NOP)
        .set(node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken));
}

function processExpressionStatement(node: tsm.ExpressionStatement, options: ProcessOptions): void {
    const { builder } = options;
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    processExpression(expr, options);
    nodeSetter.set(node);
}

function processIfStatement(node: tsm.IfStatement, options: ProcessOptions): void {
    const { builder } = options;
    const elseTarget: JumpTarget = { instruction: undefined };
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    processExpression(expr, options);
    nodeSetter.set(expr);
    builder.pushJump(OpCode.JMPIFNOT_L, elseTarget);
    processStatement(node.getThenStatement(), options);
    const _else = node.getElseStatement();
    if (_else) {
        const endTarget: JumpTarget = { instruction: undefined };
        builder.pushJump(endTarget);
        elseTarget.instruction = builder.push(OpCode.NOP).instruction;
        processStatement(_else, options);
        endTarget.instruction = builder.push(OpCode.NOP).instruction;
    } else {
        elseTarget.instruction = builder.push(OpCode.NOP).instruction;
    }
}

function processReturnStatement(node: tsm.ReturnStatement, options: ProcessOptions): void {
    const { builder } = options;
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    if (expr) { processExpression(expr, options); }
    builder.pushJump(builder.returnTarget);
    nodeSetter.set(node);
}

function processThrowStatement(node: tsm.ThrowStatement, options: ProcessOptions) {
    const { builder } = options;
    const nodeSetter = builder.getNodeSetter();

    var expr = node.getExpression();
    if (tsm.Node.isNewExpression(expr)
        && expr.getType().getSymbol()?.getName() === "Error") {

        const arg = expr.getArguments()[0];
        if (!arg) {
            builder.pushData("unknown error");
        } else {
            if (tsm.Node.isExpression(arg)) {
                processExpression(arg, options);
                builder.push(OpCode.THROW);
                nodeSetter.set(node);
                return;
            }
        }
    }

    throw new CompileError(`processThrowStatement not implemented`, node)
}

function processVariableStatement(node: tsm.VariableStatement, options: ProcessOptions): void {
    const { builder, scope } = options;

    for (const decl of node.getDeclarations()) {
        const slotIndex = options.builder.addLocalSlot();
        scope.define(s => new VariableSymbolDefinition(decl, s, SlotType.Local, slotIndex));
        const init = decl.getInitializer();
        if (init) {
            const nodeSetter = builder.getNodeSetter();
            processExpression(init, options);
            builder.pushStore(SlotType.Local, slotIndex);
            nodeSetter.set(decl);
        }
        return;
    }

    throw new CompileError(`processVariableStatement not implemented`, node);
}

function processStatement(node: tsm.Statement, options: ProcessOptions): void {
    dispatch(node, options, {
        [tsm.SyntaxKind.Block]: processBlock,
        [tsm.SyntaxKind.ExpressionStatement]: processExpressionStatement,
        [tsm.SyntaxKind.IfStatement]: processIfStatement,
        [tsm.SyntaxKind.ReturnStatement]: processReturnStatement,
        [tsm.SyntaxKind.ThrowStatement]: processThrowStatement,
        [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
    });
}

function processArrayLiteralExpression(node: tsm.ArrayLiteralExpression, options: ProcessOptions) {
    const elements = node.getElements();
    const length = elements.length;
    for (let i = 0; i < length; i++) {
        processExpression(elements[i], options);
    }
    options.builder.pushInt(length);
    options.builder.push(OpCode.PACK);
}

function processNullishCoalescingOperator(node: tsm.BinaryExpression, options: ProcessOptions) {
    const { builder } = options;
    const endTarget: JumpTarget = { instruction: undefined };

    processExpression(node.getLeft(), options);
    builder.push(OpCode.DUP); //.set(node.getOperatorToken());
    builder.push(OpCode.ISNULL);
    builder.pushJump(OpCode.JMPIFNOT_L, endTarget);
    processExpression(node.getRight(), options);
    endTarget.instruction = builder.push(OpCode.NOP).instruction;
}


function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessOptions) {
    const opTokenKind = node.getOperatorToken().getKind();

    const left = node.getLeft();
    const right = node.getRight();

    if (opTokenKind === tsm.SyntaxKind.QuestionQuestionToken) {
        return processNullishCoalescingOperator(node, options);
    }
    if (opTokenKind === tsm.SyntaxKind.EqualsToken) {
        processExpression(right, options);
        const s = left.getSymbol();
        const r = s ? options.scope.resolve(s) : undefined;

        if (r instanceof VariableSymbolDefinition) {
            options.builder.pushStore(SlotType.Local, r.index);
        }
        return;
    }

    const opCode = binaryOperatorTokenToOpCode(
        node.getOperatorToken(),
        left.getType(),
        right.getType()
    );

    processExpression(left, options);
    processExpression(right, options);
    options.builder.push(opCode);

    if (opTokenKind === tsm.SyntaxKind.PlusEqualsToken) {
        const s = left.getSymbol();
        const r = s ? options.scope.resolve(s) : undefined;

        if (r instanceof VariableSymbolDefinition) {
            options.builder.pushStore(SlotType.Local, r.index);
        }
    }


}

function binaryOperatorTokenToOpCode(
    op: tsm.Node<tsm.ts.BinaryOperatorToken>,
    left: tsm.Type,
    right: tsm.Type
): OpCode {
    switch (op.getKind()) {
        case tsm.SyntaxKind.EqualsEqualsToken:
        case tsm.SyntaxKind.EqualsEqualsEqualsToken: {
            if (isBigIntLike(left) && isBigIntLike(right)) {
                return OpCode.NUMEQUAL;
            }
            throw new Error(`getBinaryOperator.${op.getKindName()} not implemented for ${left.getText()} and ${right.getText()}`);
        }
        case tsm.SyntaxKind.LessThanToken: return OpCode.LT;
        case tsm.SyntaxKind.PlusToken:
        case tsm.SyntaxKind.PlusEqualsToken: {
            if (isStringLike(left) && isStringLike(right)) {
                return OpCode.CAT;
            }
            if (isBigIntLike(left) && isBigIntLike(right)) {
                return OpCode.ADD;
            }
            throw new Error(`getBinaryOperator.PlusToken not implemented for ${left.getText()} and ${right.getText()}`);
        }
        default:
            throw new Error(`getBinaryOperator ${op.getKindName()} not implemented`);
    }
}

function toBytes(node: tsm.Expression): Uint8Array {
    if (tsm.Node.isArrayLiteralExpression(node)) {
        const buffer = new Array<number>();
        for (const e of node.getElements()) {
            dispatch(e, undefined, {
                [tsm.SyntaxKind.NumericLiteral]: (node) => {
                    const literal = getNumericLiteral(node);
                    if (literal < 0 || literal >= 256) throw new CompileError("Invalid byte value", node);
                    buffer.push(literal);
                }
            });
        }
        return Uint8Array.from(buffer);;
    }
    throw new CompileError("toBytes", node);
}

function asExpressionOrThrow(node: tsm.Node): tsm.Expression {
    if (tsm.Node.isExpression(node)) { return node; }
    throw new CompileError(`asExpression`, node);
}

function processCallExpression(node: tsm.CallExpression, options: ProcessOptions) {

    const nodeSymbol = node.getSymbol();
    const nodeType = node.getType();
    const nodeTypeSymbol = nodeType.getAliasSymbol() ?? nodeType.getSymbol();
    const nodeTypeFQN = nodeTypeSymbol?.getFullyQualifiedName();

    const expr = node.getExpression();
    const exprType = expr.getType();
    const exprTypeSymbol = exprType.getAliasSymbol() ?? exprType.getSymbol();
    const exprTypeFQN = exprTypeSymbol?.getFullyQualifiedName();

    if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteStringConstructor.from') {
        ByteStringConstructor_from(node, options);
        return;
    }

    if (exprTypeFQN?.startsWith('"/node_modules/@neo-project/neo-contract-framework/index".StorageConstructor.')) {
        processArguments(node.getArguments(), options);
        processExpression(expr, options);
        return;
    }

    if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteString.toBigInt') {
        processExpression(expr, options);
        return;
    }

    throw new CompileError(`processCallExpression not implemented ${node.getExpression().print()}`, node);
}

function processConditionalExpression(node: tsm.ConditionalExpression, options: ProcessOptions) {

    const expr = node.getCondition();
    const exprType = expr.getType();
    const exprTypeSymbol = exprType.getAliasSymbol() ?? exprType.getSymbol();
    const exprTypeFQN = exprTypeSymbol?.getFullyQualifiedName();

    const { builder } = options;

    const falseTarget: JumpTarget = { instruction: undefined };
    const endTarget: JumpTarget = { instruction: undefined };
    processExpression(node.getCondition(), options);
    if (!exprType.isBoolean()) {
        builder.push(OpCode.ISNULL);
    }
    builder.pushJump(OpCode.JMPIFNOT_L, falseTarget);
    processExpression(node.getWhenTrue(), options);
    builder.pushJump(endTarget);
    falseTarget.instruction = builder.push(OpCode.NOP).instruction;
    processExpression(node.getWhenFalse(), options);
    endTarget.instruction = builder.push(OpCode.NOP).instruction;
}

function processIdentifier(node: tsm.Identifier, options: ProcessOptions) {

    const type = node.getType();
    const typeText = type.getText();
    const flags = tsm.TypeFlags[type.getFlags()];
    const symbol = getSymbolOrCompileError(node);
    const valDecl = symbol.getValueDeclaration()
        ?? symbol.getAliasedSymbol()?.getValueDeclaration();

    const decls = symbol.getDeclarations();
    if (!valDecl
        && decls.length === 1
        && decls[0].isKind(tsm.SyntaxKind.NamespaceImport)
    ) {
        return;
    }
    processSymbolDefinition(options.scope.resolve(symbol), node, options);
}

function processQuestionDot(hasQuestionDot: boolean, options: ProcessOptions, func: (options: ProcessOptions) => void) {
    const { builder } = options;
    if (hasQuestionDot) {
        const endTarget: JumpTarget = { instruction: undefined };
        builder.push(OpCode.DUP); //.set(node.getOperatorToken());
        builder.push(OpCode.ISNULL);
        builder.pushJump(OpCode.JMPIFNOT_L, endTarget);
        func(options);
        endTarget.instruction = builder.push(OpCode.NOP).instruction;
    } else {
        func(options);
    }
}

function processPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ProcessOptions) {

    const aNodeSymbol = node.getSymbol();
    const aNodeType = node.getType();
    const aNodeTypeSymbol = aNodeType.getAliasSymbol() ?? aNodeType.getSymbolOrThrow();
    const aNodeTypeFQN = aNodeTypeSymbol.getFullyQualifiedName();

    const expr = node.getExpression();
    const exprSymbol = expr.getSymbol();
    const exprType = expr.getType();
    const exprTypeSymbol = exprType.getAliasSymbol() ?? exprType.getSymbolOrThrow();
    const exprTypeFQN = exprTypeSymbol.getFullyQualifiedName();

    if (exprTypeSymbol.getFullyQualifiedName() === "\"/node_modules/@neo-project/neo-contract-framework/index\".StorageConstructor"
    ) {
        switch (node.getName()) {
            case "currentContext":
                options.builder.pushSysCall("System.Storage.GetContext");
                return;
            case "get":
                options.builder.pushSysCall("System.Storage.Get");
                return;
            case "put":
                options.builder.pushSysCall("System.Storage.Put");
                return;
            case "delete":
                options.builder.pushSysCall("System.Storage.Delete");
                return;
            default:
                throw new CompileError(`Unrecognized StorageConstructor method ${node.getName()}`, node);
        }
    }

    if (exprTypeSymbol.getFullyQualifiedName() === "\"/node_modules/@neo-project/neo-contract-framework/index\".ByteString"
        && node.getName() === "toBigInt"
    ) {
        processExpression(expr, options);
        processQuestionDot(node.hasQuestionDotToken(), options, (options => options.builder.pushConvert(StackItemType.Integer)));
        return;
    }

    throw new CompileError("processPropertyAccessExpression not implemented", node);
}

export function processExpression(node: tsm.Expression, options: ProcessOptions) {

    dispatch(node, options, {
        [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
        [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
        [tsm.SyntaxKind.CallExpression]: processCallExpression,
        [tsm.SyntaxKind.ConditionalExpression]: processConditionalExpression,
        [tsm.SyntaxKind.Identifier]: processIdentifier,
        [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,

        [tsm.SyntaxKind.BigIntLiteral]: (node, options) => {
            options.builder.pushInt(node.getLiteralValue() as bigint);
        },
        [tsm.SyntaxKind.FalseKeyword]: (node, options) => {
            processBoolean(node.getLiteralValue(), options);
        },
        [tsm.SyntaxKind.NumericLiteral]: (node, options) => {
            options.builder.pushInt(getNumericLiteral(node));
        },
        [tsm.SyntaxKind.StringLiteral]: (node, options) => {
            options.builder.pushData(node.getLiteralValue());
        },
        [tsm.SyntaxKind.TrueKeyword]: (node, options) => {
            processBoolean(node.getLiteralValue(), options);
        },
    });
}

export function processArguments(args: Array<tsm.Node>, options: ProcessOptions) {
    const argsLength = args.length;
    for (let i = argsLength - 1; i >= 0; i--) {
        const arg = args[i];
        if (tsm.Node.isExpression(arg)) {
            processExpression(arg, options);
        } else {
            throw new CompileError(`Unexpected call arg kind ${arg.getKindName()}`, arg);
        }
    }
}

function processBoolean(value: boolean, options: ProcessOptions) {
    const builder = options.builder;
    const opCode = value ? OpCode.PUSH1 : OpCode.PUSH0;
    builder.push(opCode);
    builder.pushConvert(StackItemType.Boolean);
}

function processSymbolDefinition(resolved: SymbolDefinition | undefined, node: tsm.Node, options: ProcessOptions) {
    if (!resolved) { throw new CompileError(`failed to resolve`, node); }

    if (resolved instanceof ParameterSymbolDefinition) {
        options.builder.pushLoad(SlotType.Parameter, resolved.index);
        return;
    }

    if (resolved instanceof VariableSymbolDefinition) {
        options.builder.pushLoad(SlotType.Local, resolved.index);
        return;
    }

    if (resolved instanceof FunctionSymbolDefinition) {
        options.builder.pushCall(resolved);
        return;
    }

    throw new CompileError(`${resolved.symbol.getName()} not implemented`, node);
}

function processFunctionDeclaration(decl: FunctionSymbolDefinition, context: CompileContext) {
    const node = decl.node;
    const body = node.getBodyOrThrow();
    if (tsm.Node.isStatement(body)) {
        const builder = new OperationBuilder(node.getParameters().length);
        processStatement(body, { builder, scope: decl, });
        builder.pushReturn();
        const instructions = builder.compile();
        context.operations.push({ node, instructions });
    } else {
        throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
    }
}

export function processFunctionDeclarationsPass(context: CompileContext): void {

    for (const symbol of context.globals.getSymbols()) {
        if (symbol instanceof FunctionSymbolDefinition) {
            processFunctionDeclaration(symbol, context);
        }
    }
}

export function getOperationInfo(node: tsm.FunctionDeclaration) {
    return {
        name: node.getNameOrThrow(),
        safe: node.getJsDocs()
            .flatMap(d => d.getTags())
            .findIndex(t => t.getTagName() === 'safe') >= 0,
        isPublic: !!node.getExportKeyword(),
        returnType: node.getReturnType(),
        parameters: node.getParameters().map((p, index) => ({
            node: p,
            name: p.getName(),
            type: p.getType(),
            index
        }))
    }
}