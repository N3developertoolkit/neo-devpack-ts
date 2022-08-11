import * as tsm from "ts-morph";
import { CompileContext, Scope, SymbolDefinition } from "../types/CompileContext";
import { CompileError } from "../compiler";
import { OperationBuilder, SlotType } from "../types/OperationBuilder";
import { OpCode } from "../types/OpCode";
import { BlockScope, FunctionSymbolDefinition, ParameterSymbolDefinition, VariableSymbolDefinition } from "../symbolTable";
import { dispatch, NodeDispatchMap } from "../utility/nodeDispatch";
import { JumpTarget } from "../types/Instruction";
import { getNumericLiteral, getSymbolOrCompileError, isBigIntLike, isStringLike } from "../utils";
import { isBuiltInSymbolDefinition } from "../builtins";
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


function deets(node: tsm.Expression) {
    const type = node.getType();
    const typeSymbol = type.getSymbol();
    const typeSymbolDecls = typeSymbol?.getDeclarations();
    const typeSymbolValueDecl = typeSymbol?.getValueDeclaration();
    const typeSymbolName = typeSymbol?.getName();
    const symbol = node.getSymbol();
    const symbolDecls = symbol?.getDeclarations();
    const symbolValueDecl = symbol?.getValueDeclaration();

    return { type, typeSymbol, typeSymbolDecls, typeSymbolValueDecl, typeSymbolName, symbol, symbolDecls, symbolValueDecl }
}

function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessOptions) {
    const opTokenKind = node.getOperatorToken().getKind();

    const left = node.getLeft();
    const right = node.getRight();
    const lDeets = deets(left);
    const rDeets = deets(right);

    if (opTokenKind === tsm.SyntaxKind.QuestionQuestionToken) {
        return processNullishCoalescingOperator(node, options);
    }

    const opCode = binaryOperatorTokenToOpCode(
        node.getOperatorToken(),
        left.getType(),
        right.getType()
    );

    processExpression(left, options);
    processExpression(right, options);
    options.builder.push(opCode);

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

function processCallExpression(node: tsm.CallExpression, options: ProcessOptions) {

    const expr = node.getExpression();

    const nodeDeets = deets(node);
    const exprDeets = deets(expr);

    processArguments(node.getArguments(), options);
    processExpression(expr, options);
}

function processIdentifier(node: tsm.Identifier, options: ProcessOptions) {

    const nodeDeets = deets(node);

    const symbol = getSymbolOrCompileError(node);
    processSymbolDefinition(options.scope.resolve(symbol), node, options);
}

function processPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ProcessOptions) {

    const expr = node.getExpression();

    const nodeDeets = deets(node);
    const exprDeets = deets(expr);

    const name = node.getNameNode();
    const exprTypeSymbolName = expr.getType().getSymbol()?.getName();
    const hasQuestionDot = node.hasQuestionDotToken();

    const symbol = name.getSymbol();
    const resolved = symbol ? options.scope.resolve(symbol) : undefined;

    // TODO: better approach for determining if we need to process the node expression
    const staticExpression = exprTypeSymbolName === 'StorageConstructor'
        || exprTypeSymbolName === 'ByteStringConstructor';

    const { builder } = options;
    const endTarget: JumpTarget = { instruction: undefined };

    if (!staticExpression) {
        processExpression(expr, options);
        if (hasQuestionDot) {
            builder.push(OpCode.DUP); //.set(node.getOperatorToken());
            builder.push(OpCode.ISNULL);
            builder.pushJump(OpCode.JMPIFNOT_L, endTarget);
        }
    }
    processSymbolDefinition(resolved, node, options);
    if (hasQuestionDot) {
        endTarget.instruction = builder.push(OpCode.NOP).instruction;
    }
}

export function processExpression(node: tsm.Expression, options: ProcessOptions) {
    dispatch(node, options, {
        [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
        [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
        [tsm.SyntaxKind.CallExpression]: processCallExpression,
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

    if (isBuiltInSymbolDefinition(resolved)) {
        resolved.invokeBuiltIn(node, options);
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