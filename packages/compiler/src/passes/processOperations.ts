import * as tsm from "ts-morph";
// import { CompileContext, Scope, SymbolDefinition } from "../types/CompileContext";
// import { CompileError } from "../compiler";
// import { OperationBuilder, SlotType } from "../types/OperationBuilder";
// import { OpCode } from "../types/OpCode";
// import { BlockScope, FunctionSymbolDefinition, ParameterSymbolDefinition, VariableSymbolDefinition } from "../symbolTable";
// import { dispatch } from "../utility/nodeDispatch";
// import { JumpTarget } from "../types/Instruction";
// import { getNumericLiteral, getSymbolOrCompileError, isBigIntLike, isCompoundAssignment, isStringLike } from "../utils";
// import { ByteStringConstructor_from } from "../builtins";
// import { StackItemType } from "../types/StackItem";

import { CompileContext, CompileError } from "../compiler";
import { BlockScope, FunctionSymbolDef, ParameterSymbolDef, resolveOrThrow, Scope, SymbolDef, VariableSymbolDef } from "../scope";
import { InstructionKind, TargetOffset } from "../types/Instruction";
import { OperationBuilder } from "../types/OperationBuilder";
import { StackItemType } from "../types/StackItem";
import { dispatch } from "../utility/nodeDispatch";
import { getSymbolOrCompileError, isBigIntLike, isBooleanLike, isStringLike } from "../utils";
import { ByteStringConstructor_from } from "./builtins";

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
    builder.push(InstructionKind.NOP)
        .set(node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken));
    node.getStatements()
        .forEach(s => processStatement(s, blockOptions));
    builder.push(InstructionKind.NOP)
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
    const elseTarget: TargetOffset = { instruction: undefined };
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    processExpression(expr, options);
    nodeSetter.set(expr);
    builder.pushJump(InstructionKind.JMPIFNOT, elseTarget);
    processStatement(node.getThenStatement(), options);
    const elseStmt = node.getElseStatement();
    if (elseStmt) {
        const endTarget: TargetOffset = { instruction: undefined };
        builder.pushJump(InstructionKind.JMP, endTarget);
        elseTarget.instruction = builder.push(InstructionKind.NOP).instruction;
        processStatement(elseStmt, options);
        endTarget.instruction = builder.push(InstructionKind.NOP).instruction;
    } else {
        elseTarget.instruction = builder.push(InstructionKind.NOP).instruction;
    }
}

function processReturnStatement(node: tsm.ReturnStatement, options: ProcessOptions): void {
    const { builder } = options;
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    if (expr) { processExpression(expr, options); }
    builder.pushJump(InstructionKind.JMP, builder.returnTarget);
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
                builder.push(InstructionKind.THROW);
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
        const slotIndex = builder.addLocalSlot();
        const symbolDef = scope.define(s => new VariableSymbolDef(decl, s, 'local', slotIndex));
        const init = decl.getInitializer();
        if (init) {
            const nodeSetter = builder.getNodeSetter();
            processExpression(init, options);
            storeSymbolDef(symbolDef, options);
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

// function processArrayLiteralExpression(node: tsm.ArrayLiteralExpression, options: ProcessOptions) {
//     const elements = node.getElements();
//     const length = elements.length;
//     for (let i = 0; i < length; i++) {
//         processExpression(elements[i], options);
//     }
//     options.builder.pushInt(length);
//     options.builder.push(OpCode.PACK);
// }

function processAsExpression(node: tsm.AsExpression, options: ProcessOptions) {
    processExpression(node.getExpression(), options);
    const type = node.getTypeNodeOrThrow().getType();
    if (isBigIntLike(type)) {
        options.builder.pushConvert(StackItemType.Integer);
    } else if (isBooleanLike(type)) {
        options.builder.pushConvert(StackItemType.Boolean);
    } else {
        throw new CompileError(`not supported`, node);
    }
}

function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessOptions) {

    const opToken = node.getOperatorToken();
    const opTokenKind = opToken.getKind();
    const left = node.getLeft();
    const right = node.getRight();

    switch (opTokenKind) {
        case tsm.SyntaxKind.QuestionQuestionToken: {
            const { builder } = options;
            processExpression(left, options);
            const endTarget: TargetOffset = { instruction: undefined };
            builder.push(InstructionKind.DUP);
            builder.push(InstructionKind.ISNULL);
            builder.pushJump(InstructionKind.JMPIFNOT, endTarget);
            processExpression(right, options)
            endTarget.instruction = builder.push(InstructionKind.NOP).instruction;
            return;
        }
        case tsm.SyntaxKind.FirstAssignment: {
            const resolved = resolveOrThrow(options.scope, left);
            processExpression(right, options);
            storeSymbolDef(resolved, options);
            return;
        }
        case tsm.SyntaxKind.PlusEqualsToken: {
            const resolved = resolveOrThrow(options.scope, left);
            processExpression(left, options);
            processExpression(right, options);
            if (isBigIntLike(left.getType()) && isBigIntLike(right.getType()))
            {
                options.builder.push(InstructionKind.ADD);
                storeSymbolDef(resolved, options);
                return;
            }
        }
        case tsm.SyntaxKind.PlusToken: {
            processExpression(left, options);
            processExpression(right, options);
            if (isBigIntLike(left.getType()) && isBigIntLike(right.getType()))
            {
                options.builder.push(InstructionKind.ADD);
                return;
            }
        }
    }

    throw new CompileError(`not implemented ${tsm.SyntaxKind[opTokenKind]}`, node);

    // if (opTokenKind === tsm.SyntaxKind.QuestionQuestionToken) {
    //     processExpression(node.getLeft(), options);
    //     processNullCoalesce(options, (options) => {
    //         processExpression(node.getRight(), options);
    //     })
    //     return;
    // }
    // if (opTokenKind === tsm.SyntaxKind.EqualsToken) {
    //     processExpression(right, options);
    //     const s = left.getSymbol();
    //     const r = s ? options.scope.resolve(s) : undefined;

    //     if (r instanceof VariableSymbolDefinition) {
    //         options.builder.pushStore(SlotType.Local, r.index);
    //     }
    //     return;
    // }

    // const opCode = binaryOperatorTokenToOpCode(
    //     node.getOperatorToken(),
    //     left.getType(),
    //     right.getType()
    // );

    processExpression(left, options);
    processExpression(right, options);
    // options.builder.push(opCode);

    // if (isCompoundAssignment(opTokenKind)) {
    //     const s = left.getSymbol();
    //     const r = s ? options.scope.resolve(s) : undefined;

    //     if (r instanceof VariableSymbolDefinition) {
    //         options.builder.pushStore(SlotType.Local, r.index);
    //     }
    // }
}

// function binaryOperatorTokenToOpCode(
//     op: tsm.Node<tsm.ts.BinaryOperatorToken>,
//     left: tsm.Type,
//     right: tsm.Type
// ): OpCode {
//     switch (op.getKind()) {
//         case tsm.SyntaxKind.EqualsEqualsToken:
//         case tsm.SyntaxKind.EqualsEqualsEqualsToken: {
//             if (isBigIntLike(left) && isBigIntLike(right)) {
//                 return OpCode.NUMEQUAL;
//             }
//             throw new Error(`getBinaryOperator.${op.getKindName()} not implemented for ${left.getText()} and ${right.getText()}`);
//         }
//         case tsm.SyntaxKind.LessThanToken:
//             return OpCode.LT;
//         case tsm.SyntaxKind.PlusToken:
//         case tsm.SyntaxKind.PlusEqualsToken: {
//             if (isStringLike(left) && isStringLike(right)) {
//                 return OpCode.CAT;
//             }
//             if (isBigIntLike(left) && isBigIntLike(right)) {
//                 return OpCode.ADD;
//             }
//             throw new Error(`getBinaryOperator.PlusToken not implemented for ${left.getText()} and ${right.getText()}`);
//         }
//         default:
//             throw new Error(`getBinaryOperator ${op.getKindName()} not implemented`);
//     }
// }

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
        const prop = expr.asKindOrThrow(tsm.SyntaxKind.PropertyAccessExpression);
        processArguments(node.getArguments(), options);

        switch (prop.getName()) {
            case "get":
                options.builder.pushSysCall("System.Storage.Get");
                break;
            case "put":
                options.builder.pushSysCall("System.Storage.Put");
                break;
            case "delete":
                options.builder.pushSysCall("System.Storage.Delete");
                break;
            default: throw new CompileError(`not supported`, prop);
        }
        return;
    }

    if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteString.toBigInt') {
        const prop = expr.asKindOrThrow(tsm.SyntaxKind.PropertyAccessExpression);
        processExpression(prop.getExpression(), options);
        
        processOptionalChain(prop.hasQuestionDotToken(), options, (options) => {
            options.builder.pushConvert(StackItemType.Integer);
        })
        return;
    }

    throw new CompileError(`processCallExpression not implemented ${node.getExpression().print()}`, node);
}
// const elseTarget: TargetOffset = { instruction: undefined };
// const nodeSetter = builder.getNodeSetter();
// const expr = node.getExpression();
// processExpression(expr, options);
// nodeSetter.set(expr);
// builder.pushJump(InstructionKind.JMPIFNOT, elseTarget);
// processStatement(node.getThenStatement(), options);
// const elseStmt = node.getElseStatement();
// if (elseStmt) {
//     const endTarget: TargetOffset = { instruction: undefined };
//     builder.pushJump(InstructionKind.JMP, endTarget);
//     elseTarget.instruction = builder.push(InstructionKind.NOP).instruction;
//     processStatement(elseStmt, options);
//     endTarget.instruction = builder.push(InstructionKind.NOP).instruction;
// } else {
//     elseTarget.instruction = builder.push(InstructionKind.NOP).instruction;
// }

function processConditionalExpression(node: tsm.ConditionalExpression, options: ProcessOptions) {

    const { builder } = options;

    const falseTarget: TargetOffset = { instruction: undefined };
    const endTarget: TargetOffset = { instruction: undefined };
    const cond = node.getCondition();
    processExpression(cond, options);
    if (!isBooleanLike(cond.getType())) {
        builder.push(InstructionKind.ISNULL);
        builder.pushJump(InstructionKind.JMPIF, falseTarget);
    } else {
        builder.pushJump(InstructionKind.JMPIFNOT, falseTarget);
    }
    processExpression(node.getWhenTrue(), options);
    builder.pushJump(InstructionKind.JMP, endTarget);
    falseTarget.instruction = builder.push(InstructionKind.NOP).instruction;
    processExpression(node.getWhenFalse(), options);
    endTarget.instruction = builder.push(InstructionKind.NOP).instruction;
}

function processIdentifier(node: tsm.Identifier, options: ProcessOptions) {

    const symbol = getSymbolOrCompileError(node);
    const resolved = options.scope.resolve(symbol);
    if (!resolved) throw new CompileError(`unresolved symbol ${symbol.getName()}`, node);
    loadSymbolDef(resolved, options);
}


function processPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ProcessOptions) {

    const expr = node.getExpression();
    const exprType = expr.getType();
    const exprTypeSymbol = exprType.getAliasSymbol() ?? exprType.getSymbolOrThrow();
    const exprTypeFQN = exprTypeSymbol.getFullyQualifiedName();

    if (exprTypeFQN === "\"/node_modules/@neo-project/neo-contract-framework/index\".StorageConstructor"
    ) {
        switch (node.getName()) {
            case "currentContext":
                options.builder.pushSysCall("System.Storage.GetContext");
                return;
            // case "get":
            //     options.builder.pushSysCall("System.Storage.Get");
            //     return;
            // case "put":
            //     options.builder.pushSysCall("System.Storage.Put");
            //     return;
            // case "delete":
            //     options.builder.pushSysCall("System.Storage.Delete");
            //     return;
            // default:
                throw new CompileError(`Unrecognized StorageConstructor method ${node.getName()}`, node);
        }
    }

    // if (exprTypeFQN === "\"/node_modules/@neo-project/neo-contract-framework/index\".ByteString"
    //     && node.getName() === "toBigInt"
    // ) {
    //     processExpression(expr, options);
    //     processNullCoalesce(node.hasQuestionDotToken(), options, (options => options.builder.pushConvert(StackItemType.Integer)));
    //     return;
    // }

    throw new CompileError("processPropertyAccessExpression not implemented", node);
}

export function processExpression(node: tsm.Expression, options: ProcessOptions) {

    dispatch(node, options, {
        // [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
        [tsm.SyntaxKind.AsExpression]: processAsExpression,
        [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
        [tsm.SyntaxKind.CallExpression]: processCallExpression,
        [tsm.SyntaxKind.ConditionalExpression]: processConditionalExpression,
        [tsm.SyntaxKind.Identifier]: processIdentifier,
        [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,

        [tsm.SyntaxKind.BigIntLiteral]: (node, options) => {
            options.builder.pushInt(node.getLiteralValue() as bigint);
        },
        [tsm.SyntaxKind.FalseKeyword]: (node, options) => {
            options.builder.pushBool(node.getLiteralValue());
        },
        [tsm.SyntaxKind.NumericLiteral]: (node, options) => {
            options.builder.pushInt(node.getLiteralValue());
        },
        [tsm.SyntaxKind.StringLiteral]: (node, options) => {
            options.builder.pushData(node.getLiteralValue());
        },
        [tsm.SyntaxKind.TrueKeyword]: (node, options) => {
            options.builder.pushBool(node.getLiteralValue());
        },
    });
}

export function processArguments(args: tsm.Node[], options: ProcessOptions) {
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

function processOptionalChain(hasQuestionDot: boolean, options: ProcessOptions, func: (options: ProcessOptions) => void) {
    const { builder } = options;
    if (hasQuestionDot) {
        const endTarget: TargetOffset = { instruction: undefined };
        builder.push(InstructionKind.DUP); //.set(node.getOperatorToken());
        builder.push(InstructionKind.ISNULL);
        builder.pushJump(InstructionKind.JMPIF, endTarget);
        func(options);
        endTarget.instruction = builder.push(InstructionKind.NOP).instruction;
    } else {
        func(options);
    }
}

// function processBoolean(value: boolean, options: ProcessOptions) {
//     const builder = options.builder;
//     const opCode = value ? OpCode.PUSH1 : OpCode.PUSH0;
//     builder.push(opCode);
//     builder.pushConvert(StackItemType.Boolean);
// }

function loadSymbolDef(resolved: SymbolDef, options: ProcessOptions) {
    if (resolved instanceof ParameterSymbolDef) {
        options.builder.pushLoad("parameter", resolved.index);
        return;
    }

    if (resolved instanceof VariableSymbolDef) {
        options.builder.pushLoad(resolved.slotType, resolved.index);
        return;
    }

    throw new Error(`loadSymbolDef failure`);
}

function storeSymbolDef(resolved: SymbolDef, options: ProcessOptions) {
    if (resolved instanceof ParameterSymbolDef) {
        options.builder.pushStore("parameter", resolved.index);
        return;
    }

    if (resolved instanceof VariableSymbolDef) {
        options.builder.pushStore(resolved.slotType, resolved.index);
        return;
    }

    throw new Error(`storeSymbolDef failure`);

}

// function processSymbolDefinition(resolved: SymbolDefinition | undefined, node: tsm.Node, options: ProcessOptions) {
//     if (!resolved) { throw new CompileError(`failed to resolve`, node); }

//     if (resolved instanceof ParameterSymbolDefinition) {
//         options.builder.pushLoad(SlotType.Parameter, resolved.index);
//         return;
//     }

//     if (resolved instanceof VariableSymbolDefinition) {
//         options.builder.pushLoad(SlotType.Local, resolved.index);
//         return;
//     }

//     if (resolved instanceof FunctionSymbolDefinition) {
//         options.builder.pushCall(resolved);
//         return;
//     }

//     throw new CompileError(`${resolved.symbol.getName()} not implemented`, node);
// }

function processFunctionDeclaration(symbolDef: FunctionSymbolDef, context: CompileContext) {
    const node = symbolDef.node;
    const body = node.getBodyOrThrow();
    if (!tsm.Node.isStatement(body)) {
        throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
    }

    const params = node.getParameters();
    const builder = new OperationBuilder(params.length);
    processStatement(body, { builder, scope: symbolDef, });
    builder.pushReturn();
    symbolDef.setInstructions(builder.instructions);
}

export function processFunctionDeclarationsPass(context: CompileContext): void {
    for (const symbolDef of context.globals.symbolDefs) {
        if (symbolDef instanceof FunctionSymbolDef) {
            processFunctionDeclaration(symbolDef, context);
        }
    }
}

// export function getOperationInfo(node: tsm.FunctionDeclaration) {
//     return {
//         name: node.getNameOrThrow(),
//         safe: node.getJsDocs()
//             .flatMap(d => d.getTags())
//             .findIndex(t => t.getTagName() === 'safe') >= 0,
//         isPublic: !!node.getExportKeyword(),
//         returnType: node.getReturnType(),
//         parameters: node.getParameters().map((p, index) => ({
//             node: p,
//             name: p.getName(),
//             type: p.getType(),
//             index
//         }))
//     }
// }