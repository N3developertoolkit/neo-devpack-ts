import * as tsm from "ts-morph";
// import { SyntaxKind } from "ts-morph";
// import { ConstantSymbolDef, FunctionSymbolDef, isFunctionDef, ReadonlyScope, SymbolDef, VariableSymbolDef } from "../symbolDef";
// import { Operation, OperationKind } from "../types/Operation";
// import { createDiagnostic } from "../utils";
// import { ProcessMethodOptions } from "./processFunctionDeclarations";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as ROM from 'fp-ts/ReadonlyMap';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import * as SG from "fp-ts/Semigroup";
import * as S from 'fp-ts/State';
import * as FP from 'fp-ts';
import * as SEP from 'fp-ts/Separated';
import { Operation } from "../types/Operation";
import { Scope } from "../scope";
import { makeParseError, ParseError } from "../symbolDef";


// // TODO: remove once we've changed the rest of the code to use parseExpression
// export function processExpression(node: tsm.Expression, { builder, diagnostics, scope }: ProcessMethodOptions) {
//     pipe(
//         node,
//         parseExpression(scope),
//         E.match(
//             (diag) => { diagnostics.push(diag) },
//             (ops) => ops.forEach(op => builder.emit(op)),
//         ));
// }

// export const parseCallArguments = (scope: ReadonlyScope) => (node: tsm.CallExpression) => {
//     const args = node.getArguments() as tsm.Expression[];
//     return parseArguments(scope)(args);

// }

// export const parseArguments = (scope: ReadonlyScope) => (args: ReadonlyArray<tsm.Expression>) => {
//     const $parseExpression = parseExpression(scope);
//     return pipe(args, ROA.reverse, ROA.map($parseExpression), concatPERs);
// }

// export const ok = <T>(value: T) => E.right<tsm.ts.Diagnostic, T>(value);
// export const error = <T>(message: string, node?: tsm.Node) => E.left<tsm.ts.Diagnostic, T>(createDiagnostic(message, { node }));

// const opToArray = (r: DiagnosticResult<Operation>) => pipe(r, E.map(ROA.of));
// const monoidPER: M.Monoid<ParseExpressionResult> = {
//     concat: E.getSemigroup<tsm.ts.Diagnostic, ReadonlyArray<Operation>>(ROA.getMonoid<Operation>()).concat,
//     empty: ok([])
// }
// export const concatPERs = M.concatAll(monoidPER);

// export type DiagnosticResult<T> = E.Either<tsm.ts.Diagnostic, T>;
// export type ParseExpressionResult = DiagnosticResult<ReadonlyArray<Operation>>;


// export const resolveIdentifier = (scope: ReadonlyScope) => (node: tsm.Identifier): DiagnosticResult<SymbolDef> => {
//     return pipe(
//         node.getSymbol(),
//         scope.resolve,
//         O.fromNullable,
//         E.fromOption(() => createDiagnostic(`resolveIdentifier ${node.getSymbol()?.getName()}`, { node })));
// }

// export const resolveCallIdentifier = (scope: ReadonlyScope) => (node: tsm.Identifier): DiagnosticResult<FunctionSymbolDef> => {
//     return pipe(
//         node,
//         resolveIdentifier(scope),
//         E.map(def => isFunctionDef(def)
//             ? ok(def)
//             : error<FunctionSymbolDef>(`${def.symbol.getName()} is not callable`, node)
//         ),
//         E.flatten
//     );
// }

// export function resolveChain(node: tsm.Expression): DiagnosticResult<ReadonlyArray<tsm.Expression>> {
//     const monoid = ROA.getMonoid<tsm.Expression>();

//     // TODO IMPROVE
//     let chain = monoid.empty;
//     while (true) {
//         chain = monoid.concat([node], chain);
//         if (tsm.Node.isIdentifier(node)) return ok(chain);
//         else if (tsm.Node.isPropertyAccessExpression(node)) node = node.getExpression();
//         else if (tsm.Node.isCallExpression(node)) node = node.getExpression();
//         else return error(`resolveChain ${node.getKindName()}`, node);
//     }
// }

// // type NodeDispatchMap<TOptions, TReturn> = {
// //     [TKind in tsm.SyntaxKind]?: (node: tsm.KindToNodeMappings[TKind], options: TOptions) => TReturn;
// // };

type ExpressionParseState = S.State<ReadonlyArray<ParseError>, ReadonlyArray<Operation>>


export const parseExpression =
    (scope: Scope) =>
        (node: tsm.Expression): ExpressionParseState =>
            (state) => {
                state = state.concat([makeParseError(node)(`parseExpression ${node.getKindName()} not implemented`)]);
                return [[], state];
            }
// export const parseExpression = (scope: ReadonlyScope) => (node: tsm.Expression): ParseExpressionResult => {
//     const $parseExpression = parseExpression(scope);

//     try {
//         // TODO can/should this be more functional?
//         if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(node, scope);
//         if (tsm.Node.isAsExpression(node)) return $parseExpression(node.getExpression());
//         if (tsm.Node.isBigIntLiteral(node)) return opToArray(parseBigIntLiteral(node));
//         if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(node, scope);
//         if (tsm.Node.isCallExpression(node)) return parseCallExpression(node, scope);
//         if (tsm.Node.isFalseLiteral(node)) return opToArray(parseBooleanLiteral(node));
//         if (tsm.Node.isIdentifier(node)) return parseIdentifier(node, scope);
//         if (tsm.Node.isNonNullExpression(node)) return $parseExpression(node.getExpression());
//         if (tsm.Node.isNullLiteral(node)) return opToArray(parseNullLiteral(node));
//         if (tsm.Node.isNumericLiteral(node)) return opToArray(parseNumericLiteral(node));
//         if (tsm.Node.isParenthesizedExpression(node)) return $parseExpression(node.getExpression());
//         if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(node, scope);
//         if (tsm.Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(node, scope);
//         if (tsm.Node.isStringLiteral(node)) return opToArray(parseStringLiteral(node));
//         if (tsm.Node.isTrueLiteral(node)) return opToArray(parseBooleanLiteral(node));
//         return error(`parseExpression ${node.getKindName()}`, node);
//     } catch ($error) {
//         const message = $error instanceof Error ? $error.message : String($error);
//         return error(message, node);
//     }
// }

// export function parseArrayLiteral(node: tsm.ArrayLiteralExpression, scope: ReadonlyScope): ParseExpressionResult {
//     const $parseExpression = parseExpression(scope);
//     const elements = node.getElements();
//     return pipe(
//         elements,
//         ROA.map($parseExpression),
//         concatPERs,
//         E.map(flow(
//             ROA.append({ kind: "pushint", value: BigInt(elements.length) } as Operation),
//             ROA.append({ kind: 'pack' } as Operation)
//         ))
//     );
// }

// export function parseBigIntLiteral(node: tsm.BigIntLiteral): DiagnosticResult<Operation> {
//     const value = node.getLiteralValue() as bigint;
//     return ok({ kind: "pushint", value, location: node });
// }

// const binaryOpTokenMap: ReadonlyMap<SyntaxKind, OperationKind> = new Map([
//     [SyntaxKind.AsteriskAsteriskToken, 'power'],
//     [SyntaxKind.AsteriskToken, 'multiply'],
//     [SyntaxKind.EqualsEqualsEqualsToken, 'equal'], // TODO: Should == and === be the same?
//     [SyntaxKind.EqualsEqualsToken, 'equal'],
//     [SyntaxKind.ExclamationEqualsToken, 'notequal'], // TODO: Should != and !== be the same?
//     [SyntaxKind.ExclamationEqualsEqualsToken, 'notequal'],
//     [SyntaxKind.GreaterThanEqualsToken, 'greaterthanorequal'],
//     [SyntaxKind.GreaterThanToken, 'greaterthan'],
//     [SyntaxKind.LessThanEqualsToken, 'lessthanorequal'],
//     [SyntaxKind.LessThanToken, 'lessthan'],
//     [SyntaxKind.PlusToken, 'add']
// ]);

// export function parseBinaryOperatorToken(node: tsm.Node<tsm.ts.BinaryOperatorToken>): DiagnosticResult<Operation> {
//     const kind = binaryOpTokenMap.get(node.getKind());
//     return kind
//         ? ok({ kind })
//         : error(`parseBinaryOperatorToken ${node.getKindName()}`, node);
// }

// export function parseBinaryExpression(node: tsm.BinaryExpression, scope: ReadonlyScope): ParseExpressionResult {
//     const $parseExpression = parseExpression(scope);

//     // TODO IMPROVE
//     return concatPERs([
//         pipe(node.getLeft(), $parseExpression),
//         pipe(node.getRight(), $parseExpression),
//         pipe(node.getOperatorToken(), parseBinaryOperatorToken, opToArray)
//     ]);
// }

// export function parseBooleanLiteral(node: tsm.FalseLiteral | tsm.TrueLiteral): DiagnosticResult<Operation> {
//     const value = node.getLiteralValue();
//     return ok({ kind: "pushbool", value, location: node });
// }

// function resolveFunctionDef(node: tsm.Identifier, scope: ReadonlyScope) {
//     const resolved = scope.resolve(node.getSymbol());
//     const zz = (resolved && isFunctionDef(resolved)) ? resolved : undefined;
//     return O.fromNullable(zz);
// }

// export function parseCallExpression(node: tsm.CallExpression, scope: ReadonlyScope): ParseExpressionResult {
//     // const $parseExpression = parseExpression(scope);
//     // const monoid = ROA.getMonoid<Operation>();

//     const chainResult = resolveChain(node.getExpression());
//     if (E.isLeft(chainResult)) return chainResult;
//     const chain = chainResult.right;
//     if (chain.length === 1) {
//         const head = ROA.head(chain);
//         if (O.isSome(head)) {
//             const id = head.value.asKind(SyntaxKind.Identifier);
//             if (id) {
//                 let resolvedResult = resolveCallIdentifier(scope)(id);
//                 if (E.isLeft(resolvedResult)) { return E.left(resolvedResult.left) }
//                 const resolved = resolvedResult.right;
//                 const { args, call } = resolved.parseCall(node, scope);
//                 return concatPERs([args, call]);
//             }
//         }
//     }

//     return error('parseCallExpression not impl', node);
// }

// export function parseLoadSymbolDef(def: SymbolDef): ParseExpressionResult {
//     if (def instanceof ConstantSymbolDef) return def.loadOperations();
//     if (def instanceof VariableSymbolDef) return def.loadOperations();
//     return error(`parseLoadSymbolDef`);
// }

// export function parseIdentifier(node: tsm.Identifier, scope: ReadonlyScope): ParseExpressionResult {
//     return pipe(
//         node,
//         resolveIdentifier(scope),
//         E.map(parseLoadSymbolDef),
//         E.flatten
//     );
// }

// function parseNullLiteral(node: tsm.NullLiteral): DiagnosticResult<Operation> {
//     return ok({ kind: "pushnull", location: node })
// }

// export function parseNumericLiteral(node: tsm.NumericLiteral): DiagnosticResult<Operation> {
//     const value = node.getLiteralValue();
//     return (Number.isInteger(value))
//         ? ok({ kind: "pushint", value: BigInt(value), location: node })
//         : error(`invalid non-integer numeric literal ${value}`, node);
// }


// const prefixUnaryOperatorMap: ReadonlyMap<SyntaxKind, OperationKind> = new Map([
//     [SyntaxKind.ExclamationToken, 'not'],
//     [SyntaxKind.MinusToken, 'negate']
// ]);

// export function parsePrefixUnaryOperator(token: tsm.ts.PrefixUnaryOperator): DiagnosticResult<Operation> {
//     const kind = prefixUnaryOperatorMap.get(token);
//     return kind
//         ? ok({ kind })
//         : error(`parsePrefixUnaryOperator ${tsm.ts.SyntaxKind[token]}`)
// }

// export function parsePrefixUnaryExpression(node: tsm.PrefixUnaryExpression, scope: ReadonlyScope): ParseExpressionResult {
//     const $parseExpression = parseExpression(scope);
//     return concatPERs([
//         pipe(node.getOperand(), $parseExpression),
//         pipe(node.getOperatorToken(), parsePrefixUnaryOperator, opToArray)]);
// }

// export function parsePropertyAccessExpression(node: tsm.PropertyAccessExpression, scope: ReadonlyScope): ParseExpressionResult {
//     return error('parsePropertyAccessExpression not impl', node);
// }

// export function parseStringLiteral(node: tsm.StringLiteral): DiagnosticResult<Operation> {
//     const value = Buffer.from(node.getLiteralValue(), 'utf8');
//     return ok({ kind: "pushdata", value, location: node });
// }
