
// // function processAsExpression(node: tsm.AsExpression, options: ProcessOptions) {
// //     processExpression(node.getExpression(), options);
// // }

import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef, SymbolDef } from "../scope";
import { dispatch } from "../utility/nodeDispatch";
import { ReadonlyUint8Array } from "../utility/ReadonlyArrays";
import { getSymbolOrCompileError } from "../utils";
import { ProcessOptions } from "./processFunctionDeclarations";

// // function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessOptions) {

// //     const opToken = node.getOperatorToken();
// //     const opTokenKind = opToken.getKind();
// //     const left = node.getLeft();
// //     const right = node.getRight();

// //     switch (opTokenKind) {
// //         case tsm.SyntaxKind.LessThanToken: {
// //             processExpression(left, options);
// //             processExpression(right, options);
// //             options.builder.push(OperationKind.LT);
// //             break;
// //         }
// //         case tsm.SyntaxKind.GreaterThanToken: {
// //             processExpression(left, options);
// //             processExpression(right, options);
// //             options.builder.push(OperationKind.LT);
// //             break;
// //         }
// //         case tsm.SyntaxKind.LessThanEqualsToken: {
// //             processExpression(left, options);
// //             processExpression(right, options);
// //             options.builder.push(OperationKind.LE);
// //             break;
// //         }
// //         case tsm.SyntaxKind.GreaterThanEqualsToken: {
// //             processExpression(left, options);
// //             processExpression(right, options);
// //             options.builder.push(OperationKind.GE);
// //             break;
// //         }
// //         case tsm.SyntaxKind.EqualsEqualsToken:
// //         case tsm.SyntaxKind.EqualsEqualsEqualsToken: {
// //             processExpression(left, options);
// //             processExpression(right, options);
// //             options.builder.push(OperationKind.NUMEQUAL);
// //             break;
// //         }
// //         case tsm.SyntaxKind.PlusToken: {
// //             processExpression(left, options);
// //             processExpression(right, options);
// //             if (isBigIntLike(left.getType()) && isBigIntLike(right.getType())) {
// //                 options.builder.push(OperationKind.ADD);
// //             }
// //             else {
// //                 throw new CompileError('not supported', opToken);
// //             }
// //             break;
// //         }
// //         case tsm.SyntaxKind.QuestionQuestionToken: {
// //             const { builder } = options;
// //             processExpression(left, options);
// //             const endTarget: TargetOffset = { operation: undefined };
// //             builder.push(OperationKind.DUP);
// //             builder.push(OperationKind.ISNULL);
// //             builder.pushJump(OperationKind.JMPIFNOT, endTarget);
// //             processExpression(right, options)
// //             endTarget.operation = builder.push(OperationKind.NOP).instruction;
// //             break;
// //         }
// //         case tsm.SyntaxKind.EqualsToken: {
// //             const resolved = resolveOrThrow(options.scope, left);
// //             processExpression(right, options);
// //             storeSymbolDef(resolved, options);
// //             break;
// //         }
// //         case tsm.SyntaxKind.PlusEqualsToken: {
// //             const resolved = resolveOrThrow(options.scope, left);
// //             processExpression(left, options);
// //             processExpression(right, options);
// //             if (isBigIntLike(left.getType()) && isBigIntLike(right.getType())) {
// //                 options.builder.push(OperationKind.ADD);
// //                 storeSymbolDef(resolved, options);
// //             } else {
// //                 throw new CompileError('not supported', opToken);
// //             }
// //             break;
// //         }
// //         default:
// //             throw new CompileError(`not implemented ${tsm.SyntaxKind[opTokenKind]}`, node);
// //     }
// // }

// // function processCallExpression(node: tsm.CallExpression, options: ProcessOptions) {

// //     const expr = node.getExpression();
// //     const exprType = expr.getType();
// //     const exprTypeSymbol = exprType.getAliasSymbol() ?? exprType.getSymbol();
// //     const exprTypeFQN = exprTypeSymbol?.getFullyQualifiedName();

// //     if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteStringConstructor.from') {
// //         ByteStringConstructor_from(node, options);
// //         return;
// //     }

// //     if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteStringConstructor.concat') {
// //         processArguments(node.getArguments(), options);
// //         options.builder.push(OperationKind.CAT)
// //         return;
// //     }

// //     if (exprTypeFQN?.startsWith('"/node_modules/@neo-project/neo-contract-framework/index".StorageConstructor.')) {
// //         const prop = expr.asKindOrThrow(tsm.SyntaxKind.PropertyAccessExpression);
// //         processArguments(node.getArguments(), options);

// //         switch (prop.getName()) {
// //             case "get":
// //                 options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_GET);
// //                 break;
// //             case "put":
// //                 options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_PUT);
// //                 break;
// //             case "delete":
// //                 options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_DELETE);
// //                 break;
// //             default: throw new CompileError(`not supported`, prop);
// //         }
// //         return;
// //     }

// //     if (exprTypeFQN === '"/node_modules/@neo-project/neo-contract-framework/index".ByteString.toBigInt') {
// //         const prop = expr.asKindOrThrow(tsm.SyntaxKind.PropertyAccessExpression);
// //         processExpression(prop.getExpression(), options);
        
// //         processOptionalChain(prop.hasQuestionDotToken(), options, (options) => {
// //             options.builder.pushConvert(sc.StackItemType.Integer);
// //         })
// //         return;
// //     }

// //     if (tsm.Node.isIdentifier(expr)) {
// //         const symbol = expr.getSymbolOrThrow();
// //         const item = options.scope.resolve(symbol);
// //         if (item instanceof FunctionSymbolDef) {
// //             processArguments(node.getArguments(), options);
// //             options.builder.pushCall(item);
// //             return;
// //         }
// //     }

// //     throw new CompileError(`processCallExpression not implemented ${expr.print()}`, node);
// // }

// // function processConditionalExpression(node: tsm.ConditionalExpression, options: ProcessOptions) {

// //     const { builder } = options;

// //     const falseTarget: TargetOffset = { operation: undefined };
// //     const endTarget: TargetOffset = { operation: undefined };
// //     const cond = node.getCondition();
// //     processExpression(cond, options);
// //     if (!isBooleanLike(cond.getType())) {
// //         builder.push(OperationKind.ISNULL);
// //         builder.pushJump(OperationKind.JMPIF, falseTarget);
// //     } else {
// //         builder.pushJump(OperationKind.JMPIFNOT, falseTarget);
// //     }
// //     processExpression(node.getWhenTrue(), options);
// //     builder.pushJump(OperationKind.JMP, endTarget);
// //     falseTarget.operation = builder.push(OperationKind.NOP).instruction;
// //     processExpression(node.getWhenFalse(), options);
// //     endTarget.operation = builder.push(OperationKind.NOP).instruction;
// // }

// @internal
export function processSymbolDef(def: SymbolDef, options: ProcessOptions) {
    const builder = options.builder;
    if (def instanceof ConstantSymbolDef) {
        const value = def.value;
        if (value === null) {
            builder.pushNull();
        } else if (value instanceof Uint8Array) {
            builder.pushData(value);
        } else {
            var type = typeof value;
            if (type === 'boolean') {
                builder.pushBoolean(value as boolean);
            } else if (type === 'bigint') {
                builder.pushInt(value as bigint);
            } else {
                throw new Error(`processSymbolDef ConstantSymbolDef ${type}`)
            }
        }
    } else {
        throw new Error(`processSymbolDef ${def.symbol.getName()}`);
    }
}

// @internal
export function processIdentifier(node: tsm.Identifier, options: ProcessOptions) {
    const symbol = getSymbolOrCompileError(node);
    const resolved = options.scope.resolve(symbol);
    if (!resolved) throw new CompileError(`unresolved symbol ${symbol.getName()}`, node);
    processSymbolDef(resolved, options);
}

export function processBooleanLiteral(node: tsm.FalseLiteral | tsm.TrueLiteral, { builder }: ProcessOptions) {
    const value = node.getLiteralValue();
    builder.pushBoolean(value);
}

export function processNumericLiteral(node: tsm.NumericLiteral, { builder }: ProcessOptions) {
    const value = node.getLiteralValue();
    if (!Number.isInteger(value)) throw new CompileError(`invalid non-integer numeric literal`, node);
    builder.pushInt(BigInt(value));
}

export function processBigIntLiteral(node: tsm.BigIntLiteral, { builder }: ProcessOptions) {
    const value = node.getLiteralValue() as bigint;
    builder.pushInt(BigInt(value));
}

export function processStringLiteral(node: tsm.StringLiteral, { builder }: ProcessOptions) {
    const value = Buffer.from(node.getLiteralValue(), 'utf8');
    builder.pushData(value);
}

function processPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ProcessOptions) {

    // TODO: left off here
    const expr = node.getExpression();
    processExpression(expr, options);

    const exprType = expr.getType();
    if (tsm.Node.isIdentifier(expr)) {
        const defs = expr.getDefinitions();
        const impl = expr.getImplementations();
        console.log([defs, impl])

    }
    // const et = expr.print();
    // const foo = node.getName();
    // console.log([et, foo]);
// //     const expr = node.getExpression();
// //     const exprType = expr.getType();
// //     const exprTypeSymbol = exprType.getAliasSymbol() ?? exprType.getSymbolOrThrow();
// //     const exprTypeFQN = exprTypeSymbol.getFullyQualifiedName();

// //     if (exprTypeFQN === "\"/node_modules/@neo-project/neo-contract-framework/index\".StorageConstructor"
// //     ) {
// //         switch (node.getName()) {
// //             case "currentContext":
// //                 options.builder.pushSysCall(sc.InteropServiceCode.SYSTEM_STORAGE_GETCONTEXT);
// //                 return;
// //             // case "get":
// //             //     options.builder.pushSysCall("System.Storage.Get");
// //             //     return;
// //             // case "put":
// //             //     options.builder.pushSysCall("System.Storage.Put");
// //             //     return;
// //             // case "delete":
// //             //     options.builder.pushSysCall("System.Storage.Delete");
// //             //     return;
// //             // default:
// //                 throw new CompileError(`Unrecognized StorageConstructor method ${node.getName()}`, node);
// //         }
// //     }

// //     // if (exprTypeFQN === "\"/node_modules/@neo-project/neo-contract-framework/index\".ByteString"
// //     //     && node.getName() === "toBigInt"
// //     // ) {
// //     //     processExpression(expr, options);
// //     //     processNullCoalesce(node.hasQuestionDotToken(), options, (options => options.builder.pushConvert(StackItemType.Integer)));
// //     //     return;
// //     // }

    throw new CompileError("processPropertyAccessExpression not implemented", node);
}

export function processExpression(node: tsm.Expression, options: ProcessOptions) {

    dispatch(node, options, {
        // [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
        // [tsm.SyntaxKind.AsExpression]: processAsExpression,
        // [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
        // [tsm.SyntaxKind.CallExpression]: processCallExpression,
        // [tsm.SyntaxKind.ConditionalExpression]: processConditionalExpression,

        [tsm.SyntaxKind.BigIntLiteral]: processBigIntLiteral,
        [tsm.SyntaxKind.FalseKeyword]: processBooleanLiteral,
        [tsm.SyntaxKind.Identifier]: processIdentifier,
        [tsm.SyntaxKind.NumericLiteral]: processNumericLiteral,
        [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,
        [tsm.SyntaxKind.StringLiteral]: processStringLiteral,
        [tsm.SyntaxKind.TrueKeyword]: processBooleanLiteral,
    });
}