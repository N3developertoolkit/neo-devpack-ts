// import * as tsm from "ts-morph";
// import { ProcessMethodOptions } from "./processFunctionDeclarations";
// import { CompileError } from "../compiler";
// import { dispatch, NodeDispatchMap } from "../utility/nodeDispatch";
// import { createBlockScope, isScope as isWritableScope, ReadonlyScope, VariableSymbolDef } from "../scope";
// import { processExpression } from "./expressionProcessor";
// import { TargetOffset } from "./MethodBuilder";
// import { isVoidLike } from "../utils";

// export function processBlock(node: tsm.Block, { diagnostics, builder, scope }: ProcessMethodOptions): void {
//     var open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
//     if (open) builder.emit('noop', open);

//     const blockScope = createBlockScope(node, scope);
//     const options = { diagnostics, builder, scope: blockScope };
//     for (const stmt of node.getStatements()) {
//         processStatement(stmt, options);
//     }

//     var close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
//     if (close) builder.emit('noop', close);
// }

// export function processExpressionStatement(node: tsm.ExpressionStatement, options: ProcessMethodOptions): void {
//     const { builder } = options;
//     const setLocation = builder.getLocationSetter();
//     const expr = node.getExpression();
//     processExpression(expr, options);
//     if (!isVoidLike(expr.getType())) { builder.emit('drop'); }
//     setLocation(node);
// }

// export function processIfStatement(node: tsm.IfStatement, options: ProcessMethodOptions): void {

//     const builder = options.builder;
//     const setLocation = builder.getLocationSetter();
//     const elseTarget: TargetOffset = { operation: undefined };
//     const expr = node.getExpression();
//     processExpression(expr, options);

//     const closeParen = node.getLastChildByKind(tsm.SyntaxKind.CloseParenToken);
//     if (closeParen) setLocation(node, closeParen);
//     else setLocation(expr);
//     builder.emitJump('jumpifnot', elseTarget);
//     const $then = node.getThenStatement();
//     const $else = node.getElseStatement();
//     processStatement($then, options);
//     if ($else) {
//         const endTarget: TargetOffset = { operation: undefined };
//         builder.emitJump('jump', endTarget);
//         elseTarget.operation = builder.emit('noop').operation;
//         processStatement($else, options);
//         endTarget.operation = builder.emit('noop').operation;
//     } else {
//         elseTarget.operation = builder.emit('noop').operation;
//     }
// }

// export function processReturnStatement(node: tsm.ReturnStatement, options: ProcessMethodOptions): void {

//     const builder = options.builder;
//     const setLocation = builder.getLocationSetter();
//     const expr = node.getExpression();
//     if (expr) {
//         processExpression(expr, options);
//     }
//     builder.emitJump("jump", builder.returnTarget);
//     setLocation(node);
// }

// export function processThrowStatement(node: tsm.ThrowStatement, options: ProcessMethodOptions): void {

//     const { builder } = options;
//     const expr = node.getExpression();
//     const setLocation = builder.getLocationSetter();
//     processExpression(expr, options);
//     builder.emit('throw');
//     setLocation(node);
// }

// export function processVariableStatement(node: tsm.VariableStatement, options: ProcessMethodOptions): void {
//     const { builder, scope } = options;

//     if (!isWritableScope(scope)) {
//         throw new CompileError(`can't declare variables in read only scope`, node);
//     } else {
//         const decls = node.getDeclarations();
//         for (const decl of decls) {
//             const index = builder.addLocal(decl);
//             const def = new VariableSymbolDef(decl.getSymbolOrThrow(), 'local', index);
//             scope.define(def);

//             const init = decl.getInitializer();
//             if (init) {
//                 const setLocation = builder.getLocationSetter();
//                 processExpression(init, options);
//                 builder.emitStore(def.kind, def.index);
//                 setLocation(decl, init);
//             }
//         }
//     }
// }

// const statementDispatchMap: NodeDispatchMap<ProcessMethodOptions> = {
//     [tsm.SyntaxKind.Block]: processBlock,
//     [tsm.SyntaxKind.ExpressionStatement]: processExpressionStatement,
//     [tsm.SyntaxKind.IfStatement]: processIfStatement,
//     [tsm.SyntaxKind.ReturnStatement]: processReturnStatement,
//     [tsm.SyntaxKind.ThrowStatement]: processThrowStatement,
//     [tsm.SyntaxKind.VariableStatement]: processVariableStatement,
// };

// export function processStatement(node: tsm.Statement, options: ProcessMethodOptions): void {
//     dispatch(node, options, statementDispatchMap);
// }




// // case SyntaxKind.BreakStatement:
// // case SyntaxKind.ClassDeclaration:
// // case SyntaxKind.ContinueStatement:
// // case SyntaxKind.DebuggerStatement:
// // case SyntaxKind.DoStatement:
// // case SyntaxKind.EmptyStatement:
// // case SyntaxKind.EnumDeclaration:
// // case SyntaxKind.ExportAssignment:
// // case SyntaxKind.ExportDeclaration:
// // case SyntaxKind.ForInStatement:
// // case SyntaxKind.ForOfStatement:
// // case SyntaxKind.ForStatement:
// // case SyntaxKind.FunctionDeclaration:
// // case SyntaxKind.ImportDeclaration:
// // case SyntaxKind.ImportEqualsDeclaration:
// // case SyntaxKind.InterfaceDeclaration:
// // case SyntaxKind.LabeledStatement:
// // case SyntaxKind.ModuleBlock:
// // case SyntaxKind.ModuleDeclaration:
// // case SyntaxKind.NotEmittedStatement:
// // case SyntaxKind.SwitchStatement:
// // case SyntaxKind.TryStatement:
// // case SyntaxKind.TypeAliasDeclaration:
// // case SyntaxKind.WhileStatement:
// // case SyntaxKind.WithStatement:

// // interface MethodStuff {
// //     readonly operations: ReadonlyArray<Operation>,
// //     readonly locals: ReadonlyArray<tsm.VariableDeclaration>,
// //     readonly jumpTargets: ReadonlyMap<JumpOperation, TargetOffset>,
// //     readonly returnTarget: TargetOffset,
// // }

// // export type ParseResult = Result<MethodStuff, tsm.ts.Diagnostic>;


// // export function createErr(message: string, node?: tsm.Node): ParseResult {
// //     const diag = createDiagnostic(message, { node });
// //     return Err(diag);
// // }

// // export function parseStatement(node: tsm.Statement, scope: ReadonlyScope): ParseResult {
// //     try {
// //         if (tsm.Node.isBlock(node)) return parseBlock(node, scope);
// //         if (tsm.Node.isExpressionStatement(node)) return parseExpressionStatement(node, scope);
// //         if (tsm.Node.isIfStatement(node)) return parseIfStatement(node);
// //         if (tsm.Node.isReturnStatement(node)) return parseReturnStatement(node, scope);
// //         if (tsm.Node.isThrowStatement(node)) return parseThrowStatement(node, scope);
// //         if (tsm.Node.isVariableStatement(node)) return parseVariableStatement(node);
// //         return createErr(`parseStatement ${node.getKindName()}`, node);
// //     } catch (error) {
// //         const message = error instanceof Error ? error.message : String(error);
// //         return createErr(message, node);
// //     }
// // }

// // function parseBlock(node: tsm.Block, scope: ReadonlyScope): ParseResult {
    
// //     return createErr(`parseBlock not implemented`, node);
// // }

// // var open = node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken);
// // if (open) builder.emit('noop', open);

// // const blockScope = new BlockScope(node, scope);
// // const options = { diagnostics, builder, scope: blockScope };
// // for (const stmt of node.getStatements()) {
// //     processStatement(stmt, options);
// // }

// // var close = node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken);
// // if (close) builder.emit('noop', close);


// // function parseExpressionStatement(node: tsm.ExpressionStatement, scope: ReadonlyScope): ParseResult {
// //     return createErr(`parseBlock not implemented`, node);
// // }

// // function parseThrowStatement(node: tsm.ThrowStatement, scope: ReadonlyScope): ParseResult {
// //     return createErr(`parseBlock not implemented`, node);
// // }

// // function parseIfStatement(node: tsm.IfStatement): ParseResult {
// //     return createErr(`parseBlock not implemented`, node);
// // }

// // function parseReturnStatement(node: tsm.ReturnStatement, scope: ReadonlyScope): ParseResult {
// //     return createErr(`parseBlock not implemented`, node);
// // }

// // function parseVariableStatement(node: tsm.VariableStatement): ParseResult {
// //     return createErr(`parseBlock not implemented`, node);
// // }

