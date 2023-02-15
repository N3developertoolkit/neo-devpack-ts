import * as tsm from "ts-morph";
import { Result, Ok, Err } from "@sniptt/monads";
import { ConstantSymbolDef, ReadonlyScope, SymbolDef, VariableSymbolDef } from "../scope";
import { Operation, PushBoolOperation, PushDataOperation, PushIntOperation } from "../types/Operation";
import { createDiagnostic } from "../utils";
import { ProcessMethodOptions } from "./processFunctionDeclarations";



// export function processArguments(args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
//     for (let i = args.length - 1; i >= 0; i--) {
//         processExpression(args[i], options);
//     }
// }

// // function callSymbolDef(def: SymbolDef, args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
// //     if (isCallable(def)) {
// //         def.emitCall(args, options);
// //     } else {
// //         throw new Error("Uncallable SymbolDef");
// //     }
// // }

// export function callIdentifier(node: tsm.Identifier, args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
//     const resolved = resolveIdentifier(node, options.scope);
//     if (resolved) {
//         if (isFunctionDef(resolved)) {
//             // resolved.emitCall(args, options)
//         } else {
//             throw new CompileError(`non function symbol ${node.getSymbolOrThrow().getName()}`, node);
//         }
//     } else {
//         throw new CompileError(`unresolved symbol ${node.getSymbolOrThrow().getName()}`, node);
//     }
// }

// // note: need to collect side effects when processing the call chain.
// // for call operations, we need to push the initial call args first, then the call chain side effects
// // For example, Storage.context.get(key) needs to be:
// //      push key, GetContext syscall, Get syscall
// // Right now, pushing the args onto the stack is the callee's responsibility, so it would end up like:
// //  GetContext syscall, Get syscall, push key

// // function processCallChain(chain: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) {
// //     let resolved: SymbolDef | undefined = undefined;
// //     let remaining = chain.slice();

// //     while (remaining.length > 0) {
// //         const head = remaining[0];
// //         remaining = remaining.slice(1);

// //         switch (head.getKind()) {
// //             case tsm.SyntaxKind.Identifier: {
// //                 if (resolved) throw new CompileError(`already resolved ${resolved.symbol.getName()}`, head);
// //                 resolved = resolveIdentifier(head as tsm.Identifier, options.scope);
// //                 if (!resolved) throw new CompileError(`failed to resolve`, head);
// //                 break;
// //             }
// //             case tsm.SyntaxKind.PropertyAccessExpression: {
// //                 if (!resolved) throw new CompileError(`unresolved`, head);
// //                 if (isObjectDef(resolved)) {
// //                     resolved = resolved.getProp((head as tsm.PropertyAccessExpression).getName(), options);
// //                     if (!resolved) throw new CompileError(`failed to resolve`, head);
// //                 } else {
// //                     throw new CompileError(`resolved ${resolved.symbol.getName()} not object`, head);
// //                 }
// //                 break;
// //             }
// //             default:
// //                 throw new CompileError(`unsupported ${head.getKindName()}`, head);
// //         }
// //     }

// //     return resolved;
// // }

// /*

// I think I need some type of monad here. I want to convert the call node expression into 
// a (args, options) => void method

// */


// interface IExpressionParser {

// }

// function monadicCalLChain(expr: tsm.Expression): (args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions) => void {
//     throw new CompileError('not implemented', expr);

// }
// export function processCallExpression(node: tsm.CallExpression, options: ProcessMethodOptions) {

//     const expr = node.getExpression();
//     const args = node.getArguments() as tsm.Expression[];

//     const foo = monadicCalLChain(expr);
//     foo(args, options);


//     // processArguments(args, options);

//     // while (chain.length > 0) {
//     //     const head = chain[0];
//     //     chain = chain.slice(1);

//     //     if (tsm.Node.isIdentifier(head)) {

//     //     }
//     // }




//     // const resolved = processCallChain(chain, options);
//     // if (!resolved) throw new CompileError("failed to resolve chain", node);
//     // if (!isFunctionDef(resolved)) throw new CompileError("failed to resolve to function", node);

//     // resolved.emitCall(args, options);




//     // const id = chain[0].asKindOrThrow(tsm.SyntaxKind.Identifier)


//     // let resolved = resolveIdentifier(id, options.scope);
//     // if (!resolved) throw new CompileError(`failed to resolve ${id.getSymbol()?.getName()}`, node);
//     // let remaining = chain.slice(1);

//     // while (remaining.length > 0) {
//     //     const head = remaining[0];
//     //     if (tsm.Node.isPropertyAccessExpression(head) && isObjectDef(resolved)) {
//     //         const newResolved = resolved.getProp(head.getName(), options);
//     //         if (!newResolved) throw new CompileError(`failed to resolve ${head.getSymbol()?.getName()}:${head.getName()}`, node);
//     //         resolved = newResolved;
//     //         remaining = remaining.slice(1);
//     //         continue;
//     //     }

//     //     throw new CompileError(`unsupported ${head.getKindName()}`, node);
//     // }

//     // if (resolved && isFunctionDef(resolved)) {
//     //     resolved.emitCall(args, options);
//     // } else {
//     //     throw new CompileError("processCallExpression", node);
//     // }

//     // // if (chain.length === 1) {
//     //     callIdentifier(first, args, options);
//     //     return;
//     // } else if (chain.length === 2) {
//     //     const resolved = resolveIdentifier(first, options.scope);
//     //     const second = chain[1].asKind(tsm.SyntaxKind.PropertyAccessExpression);
//     //     if (resolved && isObjectDef(resolved) && second) {
//     //         const prop = resolved.getProp(second.getName());
//     //         if (prop && isFunctionDef(prop)) {
//     //             prop.emitCall(null!, args, options);
//     //             return;
//     //         }
//     //     }

//     // }

//     throw new CompileError("processCallExpression", node);
//     // callIdentifier(chain.first, args, options);
//     // switch (expr.getKind()) {
//     //     case tsm.SyntaxKind.Identifier:
//     //         callIdentifier(expr as tsm.Identifier, args, options);
//     //         break;
//     //     case tsm.SyntaxKind.PropertyAccessExpression:
//     //         callPropertyAccessExpression(expr as tsm.PropertyAccessExpression, args, options);
//     //         break;
//     //     default:
//     //         throw new CompileError(`uncallable expression ${expr.getKindName()}`, expr);
//     // }
// }


// function loadSymbolDef(def: SymbolDef, options: ProcessMethodOptions) {
//     if (def instanceof ConstantSymbolDef) {
//         if (def.value === null) {
//             options.builder.emitPushNull();
//         } else if (def.value instanceof Uint8Array) {
//             options.builder.emitPushData(def.value);
//         } else {
//             switch (typeof def.value) {
//                 case 'boolean':
//                     options.builder.emitPushBoolean(def.value as boolean);
//                     break;
//                 case 'bigint':
//                     options.builder.emitPushInt(def.value as bigint);
//                     break;
//                 default:
//                     throw new Error(`ConstantSymbolDef load ${def.value}`)
//             }
//         }
//     } else if (def instanceof VariableSymbolDef) {
//         options.builder.emitLoad(def.kind, def.index);
//     } else {
//         throw new Error(`loadSymbolDef`)
//     }
// }

// export function processIdentifier(node: tsm.Identifier, options: ProcessMethodOptions) {
//     const resolved = resolveIdentifier(node, options.scope);
//     if (resolved) loadSymbolDef(resolved, options);
// }

// export function processBooleanLiteral(node: tsm.FalseLiteral | tsm.TrueLiteral, { builder }: ProcessMethodOptions) {
//     const value = node.getLiteralValue();
//     builder.emitPushBoolean(value);
// }

// export function processNumericLiteral(node: tsm.NumericLiteral, { builder }: ProcessMethodOptions) {
//     const value = node.getLiteralValue();
//     if (!Number.isInteger(value)) throw new CompileError(`invalid non-integer numeric literal`, node);
//     builder.emitPushInt(BigInt(value));
// }

// export function processBigIntLiteral(node: tsm.BigIntLiteral, { builder }: ProcessMethodOptions) {
//     const value = node.getLiteralValue() as bigint;
//     builder.emitPushInt(BigInt(value));
// }

// export function processStringLiteral(node: tsm.StringLiteral, { builder }: ProcessMethodOptions) {
//     const value = node.getLiteralValue();
//     builder.emitPushData(value);
// }

// export function processAsExpression(node: tsm.AsExpression, options: ProcessMethodOptions) {
//     const $as = node.getExpression();
//     processExpression($as, options);
// }

// export function processPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ProcessMethodOptions) {
//     const expr = node.getExpression();
//     const chain = resolveCallChain(expr);

//     // const exprType = expr.getType();
//     // const propName = node.getName();
//     // const propIndex = exprType.getProperties().findIndex(s => s.getName() === propName);
//     // if (propIndex < 0) throw new CompileError(`Could not find ${propName} on ${exprType.getSymbol()?.getName()}`, node);

//     // processExpression(expr, options);
//     // options.builder.emitPushInt(propIndex);
//     // options.builder.emit('pickitem');
// }

// export function processBinaryExpression(node: tsm.BinaryExpression, options: ProcessMethodOptions) {
//     processExpression(node.getLeft(), options);
//     processExpression(node.getRight(), options);
//     const { builder } = options;
//     const opToken = node.getOperatorToken();
//     switch (opToken.getKind()) {
//         case tsm.SyntaxKind.AsteriskAsteriskToken:
//             builder.emit('power');
//             break;
//         case tsm.SyntaxKind.AsteriskToken:
//             builder.emit('multiply');
//             break;
//         // TODO: SHould == and === be the same?
//         case tsm.SyntaxKind.EqualsEqualsEqualsToken:
//         case tsm.SyntaxKind.EqualsEqualsToken:
//             builder.emit('equal');
//             break;
//         // TODO: SHould != and !== be the same?
//         case tsm.SyntaxKind.ExclamationEqualsToken:
//         case tsm.SyntaxKind.ExclamationEqualsEqualsToken:
//             builder.emit('notequal');
//             break;
//         case tsm.SyntaxKind.GreaterThanEqualsToken:
//             builder.emit('greaterthanorequal');
//             break;
//         case tsm.SyntaxKind.GreaterThanToken:
//             builder.emit('greaterthan');
//             break;
//         case tsm.SyntaxKind.LessThanEqualsToken:
//             builder.emit('lessthanorequal');
//             break;
//         case tsm.SyntaxKind.LessThanToken:
//             builder.emit('lessthan');
//             break;
//         case tsm.SyntaxKind.PlusToken:
//             builder.emit('add');
//             break;
//         default:
//             throw new CompileError(`processBinaryExpression ${opToken.getKindName()}`, node)
//     }

//     // SyntaxKind.AmpersandAmpersandEqualsToken 
//     // SyntaxKind.AmpersandAmpersandToken 
//     // SyntaxKind.AmpersandEqualsToken 
//     // SyntaxKind.AmpersandToken 
//     // SyntaxKind.AsteriskAsteriskEqualsToken 
//     // SyntaxKind.AsteriskEqualsToken 
//     // SyntaxKind.BarBarEqualsToken 
//     // SyntaxKind.BarBarToken;
//     // SyntaxKind.BarEqualsToken 
//     // SyntaxKind.BarToken 
//     // SyntaxKind.CaretEqualsToken 
//     // SyntaxKind.CaretToken;
//     // SyntaxKind.CommaToken;
//     // SyntaxKind.EqualsToken
//     // SyntaxKind.GreaterThanGreaterThanEqualsToken 
//     // SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken 
//     // SyntaxKind.GreaterThanGreaterThanGreaterThanToken;
//     // SyntaxKind.GreaterThanGreaterThanToken 
//     // SyntaxKind.InKeyword;
//     // SyntaxKind.InstanceOfKeyword 
//     // SyntaxKind.LessThanLessThanEqualsToken 
//     // SyntaxKind.LessThanLessThanToken 
//     // SyntaxKind.MinusEqualsToken 
//     // SyntaxKind.MinusToken;
//     // SyntaxKind.PercentEqualsToken 
//     // SyntaxKind.PercentToken
//     // SyntaxKind.PlusEqualsToken 
//     // SyntaxKind.QuestionQuestionEqualsToken
//     // SyntaxKind.QuestionQuestionToken
//     // SyntaxKind.SlashEqualsToken 
//     // SyntaxKind.SlashToken 
// }

// export function processPrefixUnaryExpression(node: tsm.PrefixUnaryExpression, options: ProcessMethodOptions) {

//     const token = node.getOperatorToken();
//     switch (token) {
//         case tsm.SyntaxKind.ExclamationToken:
//             processExpression(node.getOperand(), options);
//             options.builder.emit('not');
//             break;
//         case tsm.SyntaxKind.MinusToken:
//             processExpression(node.getOperand(), options);
//             options.builder.emit('negate');
//             break;
//         default:
//             throw new CompileError(`processPrefixUnaryExpression ${tsm.ts.SyntaxKind[token]}`, node)
//     }

//     // SyntaxKind.MinusMinusToken
//     // SyntaxKind.PlusPlusToken 
//     // SyntaxKind.PlusToken
//     // SyntaxKind.TildeToken 
// }

// function processParenthesizedExpression(node: tsm.ParenthesizedExpression, options: ProcessMethodOptions) {
//     processExpression(node.getExpression(), options);
// }

// function processNullKeyword(node: tsm.NullLiteral, { builder }: ProcessMethodOptions) {
//     builder.emitPushNull();
// }

// function processNonNullExpression(node: tsm.NonNullExpression, options: ProcessMethodOptions) {
//     processExpression(node.getExpression(), options);
// }

// function processArrayLiteralExpression(node: tsm.ArrayLiteralExpression, options: ProcessMethodOptions) {
//     const elements = node.getElements();
//     elements.forEach(v => processExpression(v, options));
//     const { builder } = options;
//     builder.emitPushInt(elements.length);
//     builder.emit('pack');
// }

// const expressionDispatchMap: NodeDispatchMap<ProcessMethodOptions> = {
//         [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
//         [tsm.SyntaxKind.AsExpression]: processAsExpression,
//         [tsm.SyntaxKind.BigIntLiteral]: processBigIntLiteral,
//         [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
//         [tsm.SyntaxKind.CallExpression]: processCallExpression,
//         [tsm.SyntaxKind.FalseKeyword]: processBooleanLiteral,
//         [tsm.SyntaxKind.Identifier]: processIdentifier,
//         [tsm.SyntaxKind.NonNullExpression]: processNonNullExpression,
//         [tsm.SyntaxKind.NullKeyword]: processNullKeyword,
//         [tsm.SyntaxKind.NumericLiteral]: processNumericLiteral,
//         [tsm.SyntaxKind.ParenthesizedExpression]: processParenthesizedExpression,
//         [tsm.SyntaxKind.PrefixUnaryExpression]: processPrefixUnaryExpression,
//     [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,
//         [tsm.SyntaxKind.StringLiteral]: processStringLiteral,
//         [tsm.SyntaxKind.TrueKeyword]: processBooleanLiteral,
// };


// export function processExpression(node: tsm.Expression, options: ProcessMethodOptions) {
//     dispatch(node, options, expressionDispatchMap);
// }

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


// TODO: remove once we've changed the rest of the code to use parseExpression
export function processExpression(node: tsm.Expression, options: ProcessMethodOptions) {
    const result = parseExpression(node, options.scope);
    if (result.isErr()) {
        options.diagnostics.push(result.unwrapErr())
    } else {
        const ops = result.unwrap();
        ops.forEach(op => options.builder.emit(op));
    }
}

export type DiagnosticResult<T> = Result<T, tsm.ts.Diagnostic>;

export function resolveIdentifier(node: tsm.Identifier, scope: ReadonlyScope): DiagnosticResult<SymbolDef> {
    const symbol = node.getSymbol();
    let resolved = scope.resolve(symbol);
    if (resolved) return Ok(resolved);

    const valDeclSymbol = symbol?.getValueDeclaration()?.getSymbol();
    resolved = scope.resolve(valDeclSymbol);
    return resolved
        ? Ok(resolved)
        : Err(createDiagnostic(`resolveIdentifier ${symbol?.getName()}`, { node }));
}

export function resolveChain(node: tsm.Expression, chain?: Array<tsm.Expression>): DiagnosticResult<ReadonlyArray<tsm.Expression>> {
    chain ??= [];
    chain.push(node);
    if (tsm.Node.isIdentifier(node)) return Ok(chain.slice().reverse());
    if (tsm.Node.isPropertyAccessExpression(node)) return resolveChain(node.getExpression(), chain);
    if (tsm.Node.isCallExpression(node)) return resolveChain(node.getExpression(), chain);
    return Err(createDiagnostic(`resolveChain ${node.getKindName()}`, { node }));
}

export type ParseExpressionResult = DiagnosticResult<ReadonlyArray<Operation>>;

function bindOperations(result: ParseExpressionResult, func: () => ParseExpressionResult): ParseExpressionResult {
    return result.andThen(ops => func().map(ops2 => ops.concat(ops2)));
}

export function createErr(message: string, node?: tsm.Node): ParseExpressionResult {
    const diag = createDiagnostic(message, { node });
    return Err(diag);
}

export function parseExpression(node: tsm.Expression, scope: ReadonlyScope): ParseExpressionResult {
    try {
        if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(node, scope);
        if (tsm.Node.isAsExpression(node)) return parseExpression(node.getExpression(), scope);
        if (tsm.Node.isBigIntLiteral(node)) return parseBigIntLiteral(node);
        if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(node, scope);
        if (tsm.Node.isCallExpression(node)) return parseCallExpression(node, scope);
        if (tsm.Node.isFalseLiteral(node)) return parseBooleanLiteral(node);
        if (tsm.Node.isIdentifier(node)) return parseIdentifier(node, scope);
        if (tsm.Node.isNonNullExpression(node)) return parseExpression(node.getExpression(), scope);
        if (tsm.Node.isNullLiteral(node)) return Ok<Operation[]>([{ kind: 'pushnull', location: node }]);
        if (tsm.Node.isNumericLiteral(node)) return parseNumericLiteral(node);
        if (tsm.Node.isParenthesizedExpression(node)) return parseExpression(node.getExpression(), scope);
        if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(node, scope);
        if (tsm.Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(node, scope);
        if (tsm.Node.isStringLiteral(node)) return parseStringLiteral(node);
        if (tsm.Node.isTrueLiteral(node)) return parseBooleanLiteral(node);
        return createErr(`parseExpression ${node.getKindName()}`, node);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErr(message, node);
    }
}

export function parseArrayLiteral(node: tsm.ArrayLiteralExpression, scope: ReadonlyScope): ParseExpressionResult {
    let result: ParseExpressionResult = Ok([]);
    const elements = node.getElements();
    for (const e of elements) {
        result = bindOperations(result, () => parseExpression(e, scope));
        
        result.andThen(ops => parseExpression(e, scope).map(ops2 => ops.concat(ops2)));
    }
    return result.andThen(ops => {
        const ops2: Operation[] = [
            { kind: "pushint", value: BigInt(elements.length) } as PushIntOperation,
            { kind: 'pack' }
        ];
        return Ok(ops.concat(ops2));
    });
}

export function parseBigIntLiteral(node: tsm.BigIntLiteral): ParseExpressionResult {
    const value = node.getLiteralValue() as bigint;
    const op: PushIntOperation = { kind: "pushint", value, location: node }
    return Ok([op]);
}

export function parseBinaryOperatorToken(node: tsm.Node<tsm.ts.BinaryOperatorToken>): ParseExpressionResult {
    switch (node.getKind()) {
        case tsm.SyntaxKind.AsteriskAsteriskToken:
            return Ok<Operation[]>([{ kind: 'power' }]);
        case tsm.SyntaxKind.AsteriskToken:
            return Ok<Operation[]>([{ kind: 'multiply' }]);
        // TODO: SHould == and === be the same?
        case tsm.SyntaxKind.EqualsEqualsEqualsToken:
        case tsm.SyntaxKind.EqualsEqualsToken:
            return Ok<Operation[]>([{ kind: 'equal' }]);
        // TODO: SHould != and !== be the same?
        case tsm.SyntaxKind.ExclamationEqualsToken:
        case tsm.SyntaxKind.ExclamationEqualsEqualsToken:
            return Ok<Operation[]>([{ kind: 'notequal' }]);
        case tsm.SyntaxKind.GreaterThanEqualsToken:
            return Ok<Operation[]>([{ kind: 'greaterthanorequal' }]);
        case tsm.SyntaxKind.GreaterThanToken:
            return Ok<Operation[]>([{ kind: 'greaterthan' }]);
        case tsm.SyntaxKind.LessThanEqualsToken:
            return Ok<Operation[]>([{ kind: 'lessthanorequal' }]);
        case tsm.SyntaxKind.LessThanToken:
            return Ok<Operation[]>([{ kind: 'lessthan' }]);
        case tsm.SyntaxKind.PlusToken:
            return Ok<Operation[]>([{ kind: 'add' }]);
        default:
            return createErr(`processBinaryExpression ${node.getKindName()}`, node)
    }
}

export function parseBinaryExpression(node: tsm.BinaryExpression, scope: ReadonlyScope): ParseExpressionResult {
    return parseExpression(node.getLeft(), scope)
        .andThen(ops => parseExpression(node.getRight(), scope).map(ops2 => ops.concat(ops2)))
        .andThen(ops => parseBinaryOperatorToken(node.getOperatorToken()).map(ops2 => ops.concat(ops2)));
}

export function parseBooleanLiteral(node: tsm.FalseLiteral | tsm.TrueLiteral): ParseExpressionResult {
    const value = node.getLiteralValue();
    const op: PushBoolOperation = { kind: "pushbool", value, location: node }
    return Ok([op]);
}

export function parseCallExpression(node: tsm.CallExpression, scope: ReadonlyScope): ParseExpressionResult {
    const chain = resolveChain(node);
    if (chain.isErr()) return Err(chain.unwrapErr());
    const foo = chain.unwrap();

    const args = node.getArguments().reverse();

    let result: ParseExpressionResult = Ok([]);
    // for (const a of args) {
    //     result.andThen()
    // }

    for (const a of args) {
        parseExpression(a as tsm.Expression, scope);
    }

    return createErr('parseCallExpression not impl', node);
}

export function parseLoadSymbolDef(def: SymbolDef): ParseExpressionResult {
    if (def instanceof ConstantSymbolDef) return def.loadOperations();
    if (def instanceof VariableSymbolDef) return def.loadOperations();
    return createErr(`parseLoadSymbolDef`);
}

export function parseIdentifier(node: tsm.Identifier, scope: ReadonlyScope): ParseExpressionResult {
    return resolveIdentifier(node, scope).andThen(parseLoadSymbolDef);
}

export function parseNumericLiteral(node: tsm.NumericLiteral): ParseExpressionResult {
    const value = node.getLiteralValue();
    if (!Number.isInteger(value)) return createErr(`invalid non-integer numeric literal ${value}`, node);
    const op: PushIntOperation = { kind: "pushint", value: BigInt(value), location: node }
    return Ok([op]);
}

export function parsePrefixUnaryOperator(token: tsm.ts.PrefixUnaryOperator): ParseExpressionResult {
    switch (token) {
        case tsm.SyntaxKind.ExclamationToken:
            return Ok<Operation[]>([{ kind: 'not' }]);
        case tsm.SyntaxKind.MinusToken:
            return Ok<Operation[]>([{ kind: 'negate' }]);
        default:
            return createErr(`parsePrefixUnaryOperator ${tsm.ts.SyntaxKind[token]}`)
    }
}

export function parsePrefixUnaryExpression(node: tsm.PrefixUnaryExpression, scope: ReadonlyScope): ParseExpressionResult {
    return parseExpression(node.getOperand(), scope)
        .andThen(ops => parsePrefixUnaryOperator(node.getOperatorToken()).map(ops2 => ops.concat(ops2)));
}

export function parsePropertyAccessExpression(node: tsm.PropertyAccessExpression, scope: ReadonlyScope): ParseExpressionResult {
    return createErr('parsePropertyAccessExpression not impl', node);
}

export function parseStringLiteral(node: tsm.StringLiteral): ParseExpressionResult {
    const value = node.getLiteralValue();
    const data = Buffer.from(value, 'utf8');
    const op: PushDataOperation = { kind: "pushdata", value: data, location: node }
    return Ok([op]);
}
