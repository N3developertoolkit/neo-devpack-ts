import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { BlockScope, FunctionSymbolDef, isScope as isWritableScope, ReadonlyScope, VariableSymbolDef } from "../scope";
import { OperationKind } from "../types/Operation";
import { dispatch } from "../utility/nodeDispatch";
import { processExpression } from "./expressionProcessor";
import { ProcessOptions } from "./processFunctionDeclarations";

export function processBlock(node: tsm.Block, { builder, scope }: ProcessOptions): void {
    var open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
    builder.operation('noop', open);

    const blockScope = new BlockScope(node, scope);
    node.getStatements().forEach(
        s => processStatement(s, { builder, scope: blockScope })
    );

    var close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
    builder.operation('noop', close);
}

// // function processExpressionStatement(node: tsm.ExpressionStatement, options: ProcessOptions): void {
// //     const { builder } = options;
// //     const nodeSetter = builder.getNodeSetter();
// //     const expr = node.getExpression();
// //     processExpression(expr, options);
// //     nodeSetter.set(node);
// // }

// // function processIfStatement(node: tsm.IfStatement, options: ProcessOptions): void {
// //     const { builder } = options;
// //     const elseTarget: TargetOffset = { operation: undefined };
// //     const nodeSetter = builder.getNodeSetter();
// //     const expr = node.getExpression();
// //     processExpression(expr, options);
// //     nodeSetter.set(expr);
// //     builder.pushJump(OperationKind.JMPIFNOT, elseTarget);
// //     processStatement(node.getThenStatement(), options);
// //     const elseStmt = node.getElseStatement();
// //     if (elseStmt) {
// //         const endTarget: TargetOffset = { operation: undefined };
// //         builder.pushJump(OperationKind.JMP, endTarget);
// //         elseTarget.operation = builder.push(OperationKind.NOP).instruction;
// //         processStatement(elseStmt, options);
// //         endTarget.operation = builder.push(OperationKind.NOP).instruction;
// //     } else {
// //         elseTarget.operation = builder.push(OperationKind.NOP).instruction;
// //     }
// // }

export function processReturnStatement(node: tsm.ReturnStatement, options: ProcessOptions): void {

    const builder = options.builder;
    const locSetter = builder.getLocationSetter();
    const expr = node.getExpression();
    if (expr) { 
        processExpression(expr, options);
    }
    builder.jump(builder.returnTarget);
    locSetter(node);
}

// // function processThrowStatement(node: tsm.ThrowStatement, options: ProcessOptions) {
// //     const { builder } = options;
// //     const nodeSetter = builder.getNodeSetter();

// //     var expr = node.getExpression();
// //     if (tsm.Node.isNewExpression(expr)
// //         && expr.getType().getSymbol()?.getName() === "Error") {

// //         const arg = expr.getArguments()[0];
// //         if (!arg) {
// //             builder.pushData("unknown error");
// //         } else {
// //             if (tsm.Node.isExpression(arg)) {
// //                 processExpression(arg, options);
// //                 builder.push(OperationKind.THROW);
// //                 nodeSetter.set(node);
// //                 return;
// //             }
// //         }
// //     }

// //     throw new CompileError(`processThrowStatement not implemented`, node)
// // }

export function processVariableStatement(node: tsm.VariableStatement, options: ProcessOptions): void {
    const { builder, scope } = options;

    if (!isWritableScope(scope)) {
        throw new CompileError(`can't declare variables in read only scope`, node);
    }

    for (const decl of node.getDeclarations()) {
        const index = builder.addLocal(decl);
        scope.define(s => new VariableSymbolDef(decl, s, index));

        const init = decl.getInitializer();
        if (init) {
            const locSetter = builder.getLocationSetter();
            processExpression(init, options);
            builder.store('local', index);
            locSetter(decl);
        } 
    }
}

export function processStatement(node: tsm.Statement, options: ProcessOptions): void {
    dispatch(node, options, {
        // [tsm.SyntaxKind.ExpressionStatement]: processExpressionStatement,
        // [tsm.SyntaxKind.IfStatement]: processIfStatement,
        // [tsm.SyntaxKind.ThrowStatement]: processThrowStatement,
        

        [tsm.SyntaxKind.Block]: processBlock,
        [tsm.SyntaxKind.ReturnStatement]: processReturnStatement,
        [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
    });
}