import * as tsm from "ts-morph";
import { ProcessMethodOptions } from "./processFunctionDeclarations";
import { CompileError } from "../compiler";
import { dispatch } from "../utility/nodeDispatch";
import { BlockScope, isScope as isWritableScope, VariableSymbolDef } from "../scope";
import { processExpression } from "./expressionProcessor";
import { TargetOffset } from "./MethodBuilder";

export function processBlock(node: tsm.Block, { diagnostics, builder, scope }: ProcessMethodOptions): void {
    var open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
    if (open) builder.emit('noop', open);

    const blockScope = new BlockScope(node, scope);
    const options = { diagnostics, builder, scope: blockScope };
    for (const stmt of node.getStatements()) {
        processStatement(stmt, options);
    }

    var close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
    if (close) builder.emit('noop', close);
}

export function processExpressionStatement(node: tsm.ExpressionStatement, options: ProcessMethodOptions): void {
    const { builder } = options;
    const locSetter = builder.getLocationSetter();

    const expr = node.getExpression();
    processExpression(expr, options);
    locSetter(node);
}

export function processIfStatement(node: tsm.IfStatement, options: ProcessMethodOptions): void {
    const builder = options.builder;
    const locSetter = builder.getLocationSetter();
    const elseTarget: TargetOffset = { operation: undefined };
    const expr = node.getExpression();
    processExpression(expr, options);
    locSetter(expr);
    builder.emitJump('jumpifnot', elseTarget);
    const $then = node.getThenStatement();
    const $else = node.getElseStatement();
    processStatement($then, options);
    if ($else) {
        const endTarget: TargetOffset = { operation: undefined };
        builder.emitJump('jump', endTarget);
        elseTarget.operation = builder.emit('noop').operation;
        processStatement($else, options);
        endTarget.operation = builder.emit('noop').operation;
    } else {
        elseTarget.operation = builder.emit('noop').operation;
    }
}

export function processReturnStatement(node: tsm.ReturnStatement, options: ProcessMethodOptions): void {

    const builder = options.builder;
    const locSetter = builder.getLocationSetter();
    const expr = node.getExpression();
    if (expr) {
        processExpression(expr, options);
    }
    builder.emitJump("jump", builder.returnTarget);
    locSetter(node);
}

export function processVariableStatement(node: tsm.VariableStatement, options: ProcessMethodOptions): void {
    const { builder, scope } = options;

    if (!isWritableScope(scope)) {
        throw new CompileError(`can't declare variables in read only scope`, node);
    } else {
        for (const decl of node.getDeclarations()) {
            const index = builder.addLocal(decl);
            const def = scope.define(s => new VariableSymbolDef(decl.getSymbolOrThrow(), s, 'local', index));

            const init = decl.getInitializer();
            if (init) {
                const locSetter = builder.getLocationSetter();
                processExpression(init, options);
                builder.emitStore(def.kind, def.index);
                locSetter(decl);
            }
        }
    }
}

export function processStatement(node: tsm.Statement, options: ProcessMethodOptions): void {
    dispatch(node, options, {
        [tsm.SyntaxKind.Block]: processBlock,
        [tsm.SyntaxKind.ExpressionStatement]: processExpressionStatement,
        [tsm.SyntaxKind.IfStatement]: processIfStatement,
        [tsm.SyntaxKind.ReturnStatement]: processReturnStatement,
        [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
    });
}