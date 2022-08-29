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
import { OperationKind } from "../types/Operation";
import { FunctionBuilder, TargetOffset } from "../types/FunctionBuilder";
import { sc } from '@cityofzion/neon-core'
import { dispatch } from "../utility/nodeDispatch";
import { getSymbolOrCompileError, isBigIntLike, isBooleanLike, isStringLike } from "../utils";
import { ByteStringConstructor_from } from "./builtins";
import { timeStamp } from "console";

export interface ProcessOptions {
    builder: FunctionBuilder,
    scope: Scope,
}

function processBlock(node: tsm.Block, options: ProcessOptions): void {
    const { builder, scope } = options;
    const blockOptions = {
        builder,
        scope: new BlockScope(node, scope),
    };
    builder.push(OperationKind.NOP)
        .set(node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken));
    node.getStatements()
        .forEach(s => processStatement(s, blockOptions));
    builder.push(OperationKind.NOP)
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
    const elseTarget: TargetOffset = { operation: undefined };
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    processExpression(expr, options);
    nodeSetter.set(expr);
    builder.pushJump(OperationKind.JMPIFNOT, elseTarget);
    processStatement(node.getThenStatement(), options);
    const elseStmt = node.getElseStatement();
    if (elseStmt) {
        const endTarget: TargetOffset = { operation: undefined };
        builder.pushJump(OperationKind.JMP, endTarget);
        elseTarget.operation = builder.push(OperationKind.NOP).instruction;
        processStatement(elseStmt, options);
        endTarget.operation = builder.push(OperationKind.NOP).instruction;
    } else {
        elseTarget.operation = builder.push(OperationKind.NOP).instruction;
    }
}

function processReturnStatement(node: tsm.ReturnStatement, options: ProcessOptions): void {
    const { builder } = options;
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    if (expr) { processExpression(expr, options); }
    builder.pushJump(OperationKind.JMP, builder.returnTarget);
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
                builder.push(OperationKind.THROW);
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
        const slotIndex = builder.addLocal(decl);
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

function processAsExpression(node: tsm.AsExpression, options: ProcessOptions) {
    processExpression(node.getExpression(), options);
}

function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessOptions) {

    const opToken = node.getOperatorToken();
    const opTokenKind = opToken.getKind();
    const left = node.getLeft();
    const right = node.getRight();

    switch (opTokenKind) {
        case tsm.SyntaxKind.LessThanToken: {
            processExpression(left, options);
            processExpression(right, options);
            options.builder.push(OperationKind.LT);
            break;
        }
        case tsm.SyntaxKind.GreaterThanToken: {
            processExpression(left, options);
            processExpression(right, options);
            options.builder.push(OperationKind.LT);
            break;
        }
        case tsm.SyntaxKind.LessThanEqualsToken: {
            processExpression(left, options);
            processExpression(right, options);
            options.builder.push(OperationKind.LE);
            break;
        }
        case tsm.SyntaxKind.GreaterThanEqualsToken: {
            processExpression(left, options);
            processExpression(right, options);
            options.builder.push(OperationKind.GE);
            break;
        }
        case tsm.SyntaxKind.EqualsEqualsToken:
        case tsm.SyntaxKind.EqualsEqualsEqualsToken: {
            processExpression(left, options);
            processExpression(right, options);
            options.builder.push(OperationKind.NUMEQUAL);
            break;
        }
        case tsm.SyntaxKind.PlusToken: {
            processExpression(left, options);
            processExpression(right, options);
            if (isBigIntLike(left.getType()) && isBigIntLike(right.getType())) {
                options.builder.push(OperationKind.ADD);
            }
            else {
                throw new CompileError('not supported', opToken);
            }
            break;
        }
        case tsm.SyntaxKind.QuestionQuestionToken: {
            const { builder } = options;
            processExpression(left, options);
            const endTarget: TargetOffset = { operation: undefined };
            builder.push(OperationKind.DUP);
            builder.push(OperationKind.ISNULL);
            builder.pushJump(OperationKind.JMPIFNOT, endTarget);
            processExpression(right, options)
            endTarget.operation = builder.push(OperationKind.NOP).instruction;
            break;
        }
        case tsm.SyntaxKind.EqualsToken: {
            const resolved = resolveOrThrow(options.scope, left);
            processExpression(right, options);
            storeSymbolDef(resolved, options);
            break;
        }
        case tsm.SyntaxKind.PlusEqualsToken: {
            const resolved = resolveOrThrow(options.scope, left);
            processExpression(left, options);
            processExpression(right, options);
            if (isBigIntLike(left.getType()) && isBigIntLike(right.getType())) {
                options.builder.push(OperationKind.ADD);
                storeSymbolDef(resolved, options);
            } else {
                throw new CompileError('not supported', opToken);
            }
            break;
        }
        default:
            throw new CompileError(`not implemented ${tsm.SyntaxKind[opTokenKind]}`, node);
    }
}

function processCallExpression(node: tsm.CallExpression, options: ProcessOptions) {

    const expr = node.getExpression();
    const exprType = expr.getType();
    const exprTypeSymbol = exprType.getAliasSymbol() ?? exprType.getSymbol();
    const exprTypeFQN = exprTypeSymbol?.getFullyQualifiedName();

    if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteStringConstructor.from') {
        ByteStringConstructor_from(node, options);
        return;
    }

    if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteStringConstructor.concat') {
        processArguments(node.getArguments(), options);
        options.builder.push(OperationKind.CAT)
        return;
    }

    if (exprTypeFQN?.startsWith('"/node_modules/@neo-project/neo-contract-framework/index".StorageConstructor.')) {
        const prop = expr.asKindOrThrow(tsm.SyntaxKind.PropertyAccessExpression);
        processArguments(node.getArguments(), options);

        switch (prop.getName()) {
            case "get":
                options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_GET);
                break;
            case "put":
                options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_PUT);
                break;
            case "delete":
                options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_DELETE);
                break;
            default: throw new CompileError(`not supported`, prop);
        }
        return;
    }

    if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteString.toBigInt') {
        const prop = expr.asKindOrThrow(tsm.SyntaxKind.PropertyAccessExpression);
        processExpression(prop.getExpression(), options);
        
        processOptionalChain(prop.hasQuestionDotToken(), options, (options) => {
            options.builder.pushConvert(sc.StackItemType.Integer);
        })
        return;
    }

    if (tsm.Node.isIdentifier(expr)) {
        const symbol = expr.getSymbolOrThrow();
        const item = options.scope.resolve(symbol);
        if (item instanceof FunctionSymbolDef) {
            processArguments(node.getArguments(), options);
            options.builder.pushCall(item);
            return;
        }
    }

    throw new CompileError(`processCallExpression not implemented ${expr.print()}`, node);
}

function processConditionalExpression(node: tsm.ConditionalExpression, options: ProcessOptions) {

    const { builder } = options;

    const falseTarget: TargetOffset = { operation: undefined };
    const endTarget: TargetOffset = { operation: undefined };
    const cond = node.getCondition();
    processExpression(cond, options);
    if (!isBooleanLike(cond.getType())) {
        builder.push(OperationKind.ISNULL);
        builder.pushJump(OperationKind.JMPIF, falseTarget);
    } else {
        builder.pushJump(OperationKind.JMPIFNOT, falseTarget);
    }
    processExpression(node.getWhenTrue(), options);
    builder.pushJump(OperationKind.JMP, endTarget);
    falseTarget.operation = builder.push(OperationKind.NOP).instruction;
    processExpression(node.getWhenFalse(), options);
    endTarget.operation = builder.push(OperationKind.NOP).instruction;
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
                options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_GETCONTEXT);
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
            processBoolean(node.getLiteralValue(), options);
        },
        [tsm.SyntaxKind.NumericLiteral]: (node, options) => {
            options.builder.pushInt(node.getLiteralValue());
        },
        [tsm.SyntaxKind.StringLiteral]: (node, options) => {
            options.builder.pushData(node.getLiteralValue());
        },
        [tsm.SyntaxKind.TrueKeyword]: (node, options) => {
            processBoolean(node.getLiteralValue(), options);
        },
    });
}

function processBoolean(value: boolean, options: ProcessOptions) {
    options.builder.pushInt(value ? 1 : 0);
    options.builder.pushConvert(sc.StackItemType.Boolean);
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
        const endTarget: TargetOffset = { operation: undefined };
        builder.push(OperationKind.DUP); //.set(node.getOperatorToken());
        builder.push(OperationKind.ISNULL);
        builder.pushJump(OperationKind.JMPIF, endTarget);
        func(options);
        endTarget.operation = builder.push(OperationKind.NOP).instruction;
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
    const builder = new FunctionBuilder(params.length);
    processStatement(body, { builder, scope: symbolDef, });
    builder.pushReturn();
    context.functions.push({
        node,
        operations: [...builder.operations],
        locals: builder.locals,
    })
}

export function processFunctionDeclarationsPass(context: CompileContext): void {
    const { project, globals } = context;

    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                const symbolDef = resolveOrThrow(globals, node) as FunctionSymbolDef;
                processFunctionDeclaration(symbolDef, context);
            }
        });
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