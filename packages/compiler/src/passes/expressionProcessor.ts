// import './ext';
import { resolvePtr } from "dns";
import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef, isCallable, isLoadable, ReadonlyScope, SymbolDef, SysCallSymbolDef } from "../scope";
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

function resolveIdentifier(node: tsm.Identifier, scope: ReadonlyScope) {
    const symbol = node.getSymbolOrThrow();
    let resolved = scope.resolve(symbol);
    return resolved ?? scope.resolve(symbol.getValueDeclaration()?.getSymbol());
}

export function callIdentifier(node: tsm.Identifier, args: ReadonlyArray<tsm.Node>, options: ProcessMethodOptions) {
    const resolved = resolveIdentifier(node, options.scope);
    if (!resolved) throw new CompileError(`unresolved symbol ${node.getSymbolOrThrow().getName()}`, node);
    if (isCallable(resolved)) resolved.emitCall(args, options);
    else throw new CompileError(`Uncallable symbol ${node.getSymbolOrThrow().getName()}`, node);
}

function callPropertyAccessExpression(node: tsm.PropertyAccessExpression, args: ReadonlyArray<tsm.Node>, options: ProcessMethodOptions) {

    const expr = node.getExpression();
    const exprType = expr.getType();
    const propName = node.getName();

    const prop = options.scope.resolve(exprType.getProperty(propName));
    if (!prop) throw new CompileError(`${exprType.getText()} missing ${propName} property`, node)
    if (!isCallable(prop)) throw new CompileError(`${prop.symbol.getName()} not callable`, node)

    processExpression(expr, options);
    prop.emitCall(args, options);
}

export function processCallExpression(node: tsm.CallExpression, options: ProcessMethodOptions) {

    const expr = node.getExpression();
    const args = node.getArguments();
    switch (expr.getKind()) {
        case tsm.SyntaxKind.Identifier:
            callIdentifier(expr as tsm.Identifier, args, options);
            break;
        case tsm.SyntaxKind.PropertyAccessExpression:
            callPropertyAccessExpression(expr as tsm.PropertyAccessExpression, args, options);
            break;
        default:
            throw new CompileError(`uncallable expression ${expr.getKindName()}`, expr);
    }
}




export function processIdentifier(node: tsm.Identifier, options: ProcessMethodOptions) {
    const resolved = resolveIdentifier(node, options.scope);
    if (!resolved) throw new CompileError(`unresolved symbol ${node.getSymbolOrThrow().getName()}`, node);
    if (isLoadable(resolved)) resolved.emitLoad(options);
    else throw new CompileError(`Unloadable symbol ${node.getSymbolOrThrow().getName()}`, node);
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