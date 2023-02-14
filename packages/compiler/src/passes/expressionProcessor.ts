// import './ext';
import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef, IntrinsicValueSymbolDef, isCallable, ReadonlyScope, SymbolDef, VariableSymbolDef } from "../scope";
import { dispatch, NodeDispatchMap } from "../utility/nodeDispatch";
import { ProcessMethodOptions } from "./processFunctionDeclarations";

function resolveIdentifier(node: tsm.Identifier, scope: ReadonlyScope) {
    const symbol = node.getSymbolOrThrow();
    let resolved = scope.resolve(symbol);
    return resolved ?? scope.resolve(symbol.getValueDeclaration()?.getSymbol());
}

export function processArguments(args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
    for (let i = args.length - 1; i >= 0; i--) {
        processExpression(args[i], options);
    }
}

function callSymbolDef(def: SymbolDef, args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
    if (isCallable(def)) {
        def.emitCall(args, options);
    } else {
        throw new Error("Uncallable SymbolDef");
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
    if (def instanceof IntrinsicValueSymbolDef) {
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
        // TODO: SHould == and === be the same?
        case tsm.SyntaxKind.EqualsEqualsEqualsToken:
        case tsm.SyntaxKind.EqualsEqualsToken:
            builder.emit('equal');
            break;
        // TODO: SHould != and !== be the same?
        case tsm.SyntaxKind.ExclamationEqualsToken:
        case tsm.SyntaxKind.ExclamationEqualsEqualsToken:
            builder.emit('notequal');
            break;
        case tsm.SyntaxKind.GreaterThanEqualsToken:
            builder.emit('greaterthanorequal');
            break;
        case tsm.SyntaxKind.GreaterThanToken:
            builder.emit('greaterthan');
            break;
        case tsm.SyntaxKind.LessThanEqualsToken:
            builder.emit('lessthanorequal');
            break;
        case tsm.SyntaxKind.LessThanToken:
            builder.emit('lessthan');
            break;
        case tsm.SyntaxKind.PlusToken:
            builder.emit('add');
            break;
        default:
            throw new CompileError(`processBinaryExpression ${opToken.getKindName()}`, node)
    }

    // SyntaxKind.AmpersandAmpersandEqualsToken 
    // SyntaxKind.AmpersandAmpersandToken 
    // SyntaxKind.AmpersandEqualsToken 
    // SyntaxKind.AmpersandToken 
    // SyntaxKind.AsteriskAsteriskEqualsToken 
    // SyntaxKind.AsteriskEqualsToken 
    // SyntaxKind.BarBarEqualsToken 
    // SyntaxKind.BarBarToken;
    // SyntaxKind.BarEqualsToken 
    // SyntaxKind.BarToken 
    // SyntaxKind.CaretEqualsToken 
    // SyntaxKind.CaretToken;
    // SyntaxKind.CommaToken;
    // SyntaxKind.EqualsToken
    // SyntaxKind.GreaterThanGreaterThanEqualsToken 
    // SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken 
    // SyntaxKind.GreaterThanGreaterThanGreaterThanToken;
    // SyntaxKind.GreaterThanGreaterThanToken 
    // SyntaxKind.InKeyword;
    // SyntaxKind.InstanceOfKeyword 
    // SyntaxKind.LessThanLessThanEqualsToken 
    // SyntaxKind.LessThanLessThanToken 
    // SyntaxKind.MinusEqualsToken 
    // SyntaxKind.MinusToken;
    // SyntaxKind.PercentEqualsToken 
    // SyntaxKind.PercentToken
    // SyntaxKind.PlusEqualsToken 
    // SyntaxKind.QuestionQuestionEqualsToken
    // SyntaxKind.QuestionQuestionToken
    // SyntaxKind.SlashEqualsToken 
    // SyntaxKind.SlashToken 
}

export function processPrefixUnaryExpression(node: tsm.PrefixUnaryExpression, options: ProcessMethodOptions) {

    const token = node.getOperatorToken();
    switch (token) {
        case tsm.SyntaxKind.ExclamationToken:
            processExpression(node.getOperand(), options);
            options.builder.emit('not');
            break;
        case tsm.SyntaxKind.MinusToken:
            processExpression(node.getOperand(), options);
            options.builder.emit('negate');
            break;
        default:
            throw new CompileError(`processPrefixUnaryExpression ${tsm.ts.SyntaxKind[token]}`, node)
    }

    // SyntaxKind.MinusMinusToken
    // SyntaxKind.PlusPlusToken 
    // SyntaxKind.PlusToken
    // SyntaxKind.TildeToken 
}

function processParenthesizedExpression(node: tsm.ParenthesizedExpression, options: ProcessMethodOptions) {
    processExpression(node.getExpression(), options);
}

function processNullKeyword(node: tsm.NullLiteral, { builder }: ProcessMethodOptions) {
    builder.emitPushNull();
}

function processNonNullExpression(node: tsm.NonNullExpression, options: ProcessMethodOptions) {
    processExpression(node.getExpression(), options);
}

function processArrayLiteralExpression(node: tsm.ArrayLiteralExpression, options: ProcessMethodOptions) {
    const elements = node.getElements();
    elements.forEach(v => processExpression(v, options));
    const { builder } = options;
    builder.emitPushInt(elements.length);
    builder.emit('pack');
}

const expressionDispatchMap: NodeDispatchMap<ProcessMethodOptions> = {
    [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
    [tsm.SyntaxKind.AsExpression]: processAsExpression,
    [tsm.SyntaxKind.BigIntLiteral]: processBigIntLiteral,
    [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
    [tsm.SyntaxKind.CallExpression]: processCallExpression,
    [tsm.SyntaxKind.FalseKeyword]: processBooleanLiteral,
    [tsm.SyntaxKind.Identifier]: processIdentifier,
    [tsm.SyntaxKind.NonNullExpression]: processNonNullExpression,
    [tsm.SyntaxKind.NullKeyword]: processNullKeyword,
    [tsm.SyntaxKind.NumericLiteral]: processNumericLiteral,
    [tsm.SyntaxKind.ParenthesizedExpression]: processParenthesizedExpression,
    [tsm.SyntaxKind.PrefixUnaryExpression]: processPrefixUnaryExpression,
    [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,
    [tsm.SyntaxKind.StringLiteral]: processStringLiteral,
    [tsm.SyntaxKind.TrueKeyword]: processBooleanLiteral,
};


export function processExpression(node: tsm.Expression, options: ProcessMethodOptions) {
    dispatch(node, options, expressionDispatchMap);
}

// case SyntaxKind.AnyKeyword:
// case SyntaxKind.ArrayLiteralExpression:
// case SyntaxKind.ArrowFunction:
// case SyntaxKind.AwaitExpression:
// case SyntaxKind.BooleanKeyword:
// case SyntaxKind.ClassExpression:
// case SyntaxKind.CommaListExpression:
// case SyntaxKind.ConditionalExpression:
// case SyntaxKind.DeleteExpression:
// case SyntaxKind.ElementAccessExpression:
// case SyntaxKind.FunctionExpression:
// case SyntaxKind.ImportKeyword:
    // case SyntaxKind.JsxClosingFragment:
    // case SyntaxKind.JsxElement:
    // case SyntaxKind.JsxExpression:
    // case SyntaxKind.JsxFragment:
    // case SyntaxKind.JsxOpeningElement:
    // case SyntaxKind.JsxOpeningFragment:
    // case SyntaxKind.JsxSelfClosingElement:
// case SyntaxKind.MetaProperty:
// case SyntaxKind.NewExpression:
// case SyntaxKind.NoSubstitutionTemplateLiteral:
// case SyntaxKind.NumberKeyword:
// case SyntaxKind.ObjectKeyword:
// case SyntaxKind.ObjectLiteralExpression:
// case SyntaxKind.OmittedExpression:
// case SyntaxKind.PartiallyEmittedExpression:
// case SyntaxKind.PostfixUnaryExpression:
// case SyntaxKind.RegularExpressionLiteral:
// case SyntaxKind.SpreadElement:
// case SyntaxKind.StringKeyword:
// case SyntaxKind.SuperKeyword:
// case SyntaxKind.SymbolKeyword:
// case SyntaxKind.TaggedTemplateExpression:
// case SyntaxKind.TemplateExpression:
// case SyntaxKind.ThisKeyword:
// case SyntaxKind.TypeAssertionExpression:
// case SyntaxKind.TypeOfExpression:
// case SyntaxKind.UndefinedKeyword:
// case SyntaxKind.VoidExpression:
// case SyntaxKind.YieldExpression:
