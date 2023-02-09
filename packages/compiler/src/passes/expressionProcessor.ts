// import './ext';
import { open } from "fs";
import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef, IntrinsicMethodDef, IntrinsicSymbolDef, MethodSymbolDef, MethodTokenSymbolDef, OperationsSymbolDef, ReadonlyScope, SymbolDef, SysCallSymbolDef, VariableSymbolDef } from "../scope";
import { dispatch } from "../utility/nodeDispatch";
import { ProcessMethodOptions } from "./processFunctionDeclarations";

function resolveIdentifier(node: tsm.Identifier, scope: ReadonlyScope) {
    const symbol = node.getSymbolOrThrow();
    let resolved = scope.resolve(symbol);
    return resolved ?? scope.resolve(symbol.getValueDeclaration()?.getSymbol());
}

function processArguments(args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
    for (let i = args.length - 1; i >= 0; i--) {
        processExpression(args[i], options);
    }
}

function callSymbolDef(def: SymbolDef, args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
    if (def instanceof SysCallSymbolDef) {
        processArguments(args, options);
        options.builder.emitSysCall(def.name);
    } else if (def instanceof IntrinsicMethodDef) {
        def.emitCall(args, options);
    } else if (def instanceof MethodTokenSymbolDef) {
        processArguments(args, options);
        options.builder.emitCallToken(def.token);
    } else if (def instanceof OperationsSymbolDef) {
        processArguments(args, options);
        for (const op of def.operations) {
            options.builder.emit(op);
        }
    } else if (def instanceof MethodSymbolDef) {
        processArguments(args, options);
        options.builder.emitCall(def);
    } else {
        throw new Error("callSymbolDef: unknown SymbolDef type")
    }
}

export function callIdentifier(node: tsm.Identifier, args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
    const resolved = resolveIdentifier(node, options.scope);
    if (!resolved) throw new CompileError(`unresolved symbol ${node.getSymbolOrThrow().getName()}`, node);
    else callSymbolDef(resolved, args, options);
}

function callPropertyAccessExpression(node: tsm.PropertyAccessExpression, args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {

    const expr = node.getExpression();
    const exprType = expr.getType();
    const propName = node.getName();

    const prop = options.scope.resolve(exprType.getProperty(propName));
    if (!prop) throw new CompileError(`${exprType.getText()} missing ${propName} property`, node)

    processExpression(expr, options);
    callSymbolDef(prop, args, options);
}

export function processCallExpression(node: tsm.CallExpression, options: ProcessMethodOptions) {

    const expr = node.getExpression();
    for (const arg of node.getArguments()) {
        if (!tsm.Node.isExpression(arg)) throw new CompileError("invalid argument", arg);
    }
    const args = node.getArguments() as tsm.Expression[];
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


function loadSymbolDef(def: SymbolDef, options: ProcessMethodOptions) {
    if (def instanceof IntrinsicSymbolDef) {
        // nothing to do here
    } else if (def instanceof ConstantSymbolDef) {
        if (def.value === null) {
            options.builder.emitPushNull();
        } else if (def.value instanceof Uint8Array) {
            options.builder.emitPushData(def.value);
        } else {
            switch (typeof def.value) {
                case 'boolean':
                    options.builder.emitPushBoolean(def.value as boolean);
                    break;
                case 'bigint':
                    options.builder.emitPushInt(def.value as bigint);
                    break;
                default:
                    throw new Error(`ConstantSymbolDef load ${def.value}`)
            }
        }
    } else if (def instanceof VariableSymbolDef) {
        options.builder.emitLoad(def.kind, def.index);

    }
}

export function processIdentifier(node: tsm.Identifier, options: ProcessMethodOptions) {
    const resolved = resolveIdentifier(node, options.scope);
    if (resolved) loadSymbolDef(resolved, options);
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
    const value = node.getLiteralValue(); 
    builder.emitPushData(value);
}

export function processAsExpression(node: tsm.AsExpression, options: ProcessMethodOptions) {
    const $as = node.getExpression();
    processExpression($as, options);
}

export function processPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ProcessMethodOptions) {
    const expr = node.getExpression();
    const exprType = expr.getType();
    const propName = node.getName();
    const propIndex = exprType.getProperties().findIndex(s => s.getName() === propName);
    if (propIndex < 0) throw new CompileError(`Could not find ${propName} on ${exprType.getSymbol()?.getName()}`, node);

    processExpression(expr, options);
    options.builder.emitPushInt(propIndex);
    options.builder.emit('pickitem');
}

// export function processNewExpression(node: tsm.NewExpression, options: ProcessMethodOptions) {
//     const args = node.getArguments();
//     const expr = node.getExpression();
//     console.log();
// }

export function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessMethodOptions) {
    processExpression(node.getLeft(), options);
    processExpression(node.getRight(), options);
    const { builder } = options;
    const opToken = node.getOperatorToken();
    switch (opToken.getKind()) {
        case tsm.SyntaxKind.AsteriskAsteriskToken:
            builder.emit('power');
            break;
        case tsm.SyntaxKind.AsteriskToken:
            builder.emit('multiply');
            break;
        case tsm.SyntaxKind.EqualsEqualsToken:
        case tsm.SyntaxKind.EqualsEqualsEqualsToken:
            builder.emit('equal');
            break;
        case tsm.SyntaxKind.GreaterThanToken:
            builder.emit('greaterthan');
            break;
        case tsm.SyntaxKind.GreaterThanEqualsToken:
            builder.emit('greaterthanorequal');
            break;
        case tsm.SyntaxKind.LessThanToken:
            builder.emit('lessthan');
            break;
        case tsm.SyntaxKind.LessThanEqualsToken:
            builder.emit('lessthanorequal');
            break;
        case tsm.SyntaxKind.PrefixUnaryExpression:
            break;
        case tsm.SyntaxKind.PlusToken:
            builder.emit('add');
            break;
        default:
            throw new CompileError(`processBinaryExpression ${opToken.getKindName()}`, node)
    }
}

export function processPrefixUnaryExpression(node: tsm.PrefixUnaryExpression, options: ProcessMethodOptions) {
    
    processExpression(node.getOperand(), options);
    const token = node.getOperatorToken();
    switch (token) {
        case tsm.SyntaxKind.ExclamationToken:
            options.builder.emit('not');
            break;
        default: 
            throw new CompileError(`processPrefixUnaryExpression ${tsm.ts.SyntaxKind[token]}`, node)
    }
}

export function processParenthesizedExpression(node: tsm.ParenthesizedExpression, options: ProcessMethodOptions) {
    processExpression(node.getExpression(), options);
} 

export function processExpression(node: tsm.Expression, options: ProcessMethodOptions) {

    dispatch(node, options, {
        [tsm.SyntaxKind.AsExpression]: processAsExpression,
        [tsm.SyntaxKind.BigIntLiteral]: processBigIntLiteral,
        [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
        [tsm.SyntaxKind.CallExpression]: processCallExpression,
        [tsm.SyntaxKind.FalseKeyword]: processBooleanLiteral,
        [tsm.SyntaxKind.Identifier]: processIdentifier,
        [tsm.SyntaxKind.NonNullExpression]: (node) => { processExpression(node.getExpression(), options); },
        [tsm.SyntaxKind.NullKeyword]: (node) => { options.builder.emitPushNull(); },
        // [tsm.SyntaxKind.NewExpression]: processNewExpression,
        [tsm.SyntaxKind.NumericLiteral]: processNumericLiteral,
        [tsm.SyntaxKind.ParenthesizedExpression]: processParenthesizedExpression, 
        [tsm.SyntaxKind.PrefixUnaryExpression]: processPrefixUnaryExpression,
        [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,
        [tsm.SyntaxKind.StringLiteral]: processStringLiteral,
        [tsm.SyntaxKind.TrueKeyword]: processBooleanLiteral,
    });
}