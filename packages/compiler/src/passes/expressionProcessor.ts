// import './ext';
import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef, IntrinsicMethodDef, IntrinsicSymbolDef, ReadonlyScope, SymbolDef, SysCallSymbolDef, VariableSymbolDef } from "../scope";
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
    } else {
        throw new Error("callSymbolDef")
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