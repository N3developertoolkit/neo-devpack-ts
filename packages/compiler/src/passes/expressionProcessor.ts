// import './ext';
import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef, isCallable, isLoadable, SymbolDef, SysCallSymbolDef } from "../scope";
// import { ConstantSymbolDef, SymbolDef } from "../scope";
import { dispatch } from "../utility/nodeDispatch";
import { ProcessMethodOptions } from "./processFunctionDeclarations";
// import { ReadonlyUint8Array } from "../utility/ReadonlyArrays";
// import { ProcessOptions } from "./processFunctionDeclarations";

// // // function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessOptions) {

// // //     const opToken = node.getOperatorToken();
// // //     const opTokenKind = opToken.getKind();
// // //     const left = node.getLeft();
// // //     const right = node.getRight();

// // //     switch (opTokenKind) {
// // //         case tsm.SyntaxKind.LessThanToken: {
// // //             processExpression(left, options);
// // //             processExpression(right, options);
// // //             options.builder.push(OperationKind.LT);
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.GreaterThanToken: {
// // //             processExpression(left, options);
// // //             processExpression(right, options);
// // //             options.builder.push(OperationKind.LT);
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.LessThanEqualsToken: {
// // //             processExpression(left, options);
// // //             processExpression(right, options);
// // //             options.builder.push(OperationKind.LE);
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.GreaterThanEqualsToken: {
// // //             processExpression(left, options);
// // //             processExpression(right, options);
// // //             options.builder.push(OperationKind.GE);
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.EqualsEqualsToken:
// // //         case tsm.SyntaxKind.EqualsEqualsEqualsToken: {
// // //             processExpression(left, options);
// // //             processExpression(right, options);
// // //             options.builder.push(OperationKind.NUMEQUAL);
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.PlusToken: {
// // //             processExpression(left, options);
// // //             processExpression(right, options);
// // //             if (isBigIntLike(left.getType()) && isBigIntLike(right.getType())) {
// // //                 options.builder.push(OperationKind.ADD);
// // //             }
// // //             else {
// // //                 throw new CompileError('not supported', opToken);
// // //             }
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.QuestionQuestionToken: {
// // //             const { builder } = options;
// // //             processExpression(left, options);
// // //             const endTarget: TargetOffset = { operation: undefined };
// // //             builder.push(OperationKind.DUP);
// // //             builder.push(OperationKind.ISNULL);
// // //             builder.pushJump(OperationKind.JMPIFNOT, endTarget);
// // //             processExpression(right, options)
// // //             endTarget.operation = builder.push(OperationKind.NOP).instruction;
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.EqualsToken: {
// // //             const resolved = resolveOrThrow(options.scope, left);
// // //             processExpression(right, options);
// // //             storeSymbolDef(resolved, options);
// // //             break;
// // //         }
// // //         case tsm.SyntaxKind.PlusEqualsToken: {
// // //             const resolved = resolveOrThrow(options.scope, left);
// // //             processExpression(left, options);
// // //             processExpression(right, options);
// // //             if (isBigIntLike(left.getType()) && isBigIntLike(right.getType())) {
// // //                 options.builder.push(OperationKind.ADD);
// // //                 storeSymbolDef(resolved, options);
// // //             } else {
// // //                 throw new CompileError('not supported', opToken);
// // //             }
// // //             break;
// // //         }
// // //         default:
// // //             throw new CompileError(`not implemented ${tsm.SyntaxKind[opTokenKind]}`, node);
// // //     }
// // // }

// // // function processConditionalExpression(node: tsm.ConditionalExpression, options: ProcessOptions) {

// // //     const { builder } = options;

// // //     const falseTarget: TargetOffset = { operation: undefined };
// // //     const endTarget: TargetOffset = { operation: undefined };
// // //     const cond = node.getCondition();
// // //     processExpression(cond, options);
// // //     if (!isBooleanLike(cond.getType())) {
// // //         builder.push(OperationKind.ISNULL);
// // //         builder.pushJump(OperationKind.JMPIF, falseTarget);
// // //     } else {
// // //         builder.pushJump(OperationKind.JMPIFNOT, falseTarget);
// // //     }
// // //     processExpression(node.getWhenTrue(), options);
// // //     builder.pushJump(OperationKind.JMP, endTarget);
// // //     falseTarget.operation = builder.push(OperationKind.NOP).instruction;
// // //     processExpression(node.getWhenFalse(), options);
// // //     endTarget.operation = builder.push(OperationKind.NOP).instruction;
// // // }

export function processIdentifierCall(node: tsm.Identifier, {builder, scope}: ProcessMethodOptions) {
    const symbol = node.getSymbolOrThrow();
    const resolved = scope.resolve(symbol);
    if (!resolved) throw new CompileError(`unresolved symbol ${symbol.getName()}`, node);
    if (isCallable(resolved)) resolved.emitCall(builder);
    else throw new CompileError(`Uncallable symbol ${symbol.getName()}`, node);
}

function processPropertyAccessExpressionCall(node: tsm.PropertyAccessExpression, options: ProcessMethodOptions) {

    const expr = node.getExpression();
    const sym = expr.getSymbol()?.getValueDeclaration()?.getSymbol() ?? expr.getSymbolOrThrow();
    const r1 = options.scope.resolve(sym);

    // this works for resolving UInt8Array to intrinsic
    const sym2 = sym.getValueDeclaration()?.getSymbol();
    const r2 = sym2 ? options.scope.resolve(sym2) : undefined;

    processExpression(expr, options);


    // Uint8Array

    /*
    UInt8Array is an intrinsic object in JS
        the intrinsic UInt8Array is typed as a UInt8ArrayConstructor

    */

    // throw new CompileError("not implemented", node);
}

export function processCallExpression(node: tsm.CallExpression, options: ProcessMethodOptions) {

    // arguments

    const expr = node.getExpression();
    dispatch(node.getExpression(), options, {
        [tsm.SyntaxKind.Identifier]: processIdentifierCall,
        [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpressionCall,
    });

    // 
    // processExpression(expr, options);

    // if (tsm.Node.isIdentifier(expr)) {
    //     const resolved = scope.resolve(expr.getSymbolOrThrow());
    //     if (resolved) {
    //         if (resolved instanceof SysCallSymbolDef) {
    //             builder.syscall(resolved.name);
    //             return;
    //         }
    //     }
    // } else if (tsm.Node.isPropertyAccessExpression(expr)) {
    //     const owner = expr.getExpression();
    //     const propName = expr.getName();
    //     const t = owner.getType().getText();
    //     console.log();
    // }



    // throw new CompileError("not implemented", node);
}




export function processIdentifier(node: tsm.Identifier, {builder, scope}: ProcessMethodOptions) {
    const symbol = node.getSymbolOrThrow();
    const resolved = scope.resolve(symbol);
    if (!resolved) throw new CompileError(`unresolved symbol ${symbol.getName()}`, node);
    if (isLoadable(resolved)) resolved.emitLoad(builder);
    else throw new CompileError(`Unloadable symbol ${symbol.getName()}`, node);
}

export function processBooleanLiteral(node: tsm.FalseLiteral | tsm.TrueLiteral, { builder }: ProcessMethodOptions) {
    const value = node.getLiteralValue();
    builder.emitPushBoolean(value);
}

export function processNumericLiteral(node: tsm.NumericLiteral, { builder }: ProcessMethodOptions) {
    const value = node.getLiteralValue();
    if (!Number.isInteger(value)) throw new CompileError(`invalid non-integer numeric literal`, node);
    builder.emitPushInt(BigInt(value));
}

export function processBigIntLiteral(node: tsm.BigIntLiteral, { builder }: ProcessMethodOptions) {
    const value = node.getLiteralValue() as bigint;
    builder.emitPushInt(BigInt(value));
}

export function processStringLiteral(node: tsm.StringLiteral, { builder }: ProcessMethodOptions) {
    const value = Buffer.from(node.getLiteralValue(), 'utf8');
    builder.emitPushData(value);
}

export function processExpression(node: tsm.Expression, options: ProcessMethodOptions) {

    dispatch(node, options, {
        // [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
        // [tsm.SyntaxKind.AsExpression]: processAsExpression,
        // [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
        // [tsm.SyntaxKind.ConditionalExpression]: processConditionalExpression,
        // [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,

        [tsm.SyntaxKind.BigIntLiteral]: processBigIntLiteral,
        [tsm.SyntaxKind.CallExpression]: processCallExpression,
        [tsm.SyntaxKind.FalseKeyword]: processBooleanLiteral,
        [tsm.SyntaxKind.Identifier]: processIdentifier,
        [tsm.SyntaxKind.NumericLiteral]: processNumericLiteral,
        [tsm.SyntaxKind.StringLiteral]: processStringLiteral,
        [tsm.SyntaxKind.TrueKeyword]: processBooleanLiteral,
    });
}