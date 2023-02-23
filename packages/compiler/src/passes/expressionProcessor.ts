import * as tsm from "ts-morph";
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
import { Operation, OperationKind, PushBoolOperation, PushDataOperation, PushIntOperation } from "../types/Operation";
import { resolve, Scope } from "../scope";
import { ConstantSymbolDef, isLoadableDef, makeParseError, ParseError, VariableSymbolDef } from "../symbolDef";
import { fail } from "assert";


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

const failState =
    (node: tsm.Node) =>
        (message: string): ExpressionParseState =>
            (state) => [[], state.concat([makeParseError(node)(message)])];


export const parseExpression =
    (scope: Scope) =>
        (node: tsm.Expression): ExpressionParseState =>
            (state) => {
                if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node)(state);
                if (tsm.Node.isAsExpression(node)) return parseExpression(scope)(node.getExpression())(state);
                if (tsm.Node.isBigIntLiteral(node)) return parseBigIntLiteral(node)(state);
                if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node)(state);
                // if (tsm.Node.isCallExpression(node)) return parseCallExpression(node, scope);
                if (tsm.Node.isFalseLiteral(node)) return parseBooleanLiteral(node)(state);
                if (tsm.Node.isIdentifier(node)) return parseIdentifier(scope)(node)(state);
                if (tsm.Node.isNonNullExpression(node)) return parseExpression(scope)(node.getExpression())(state);
                if (tsm.Node.isNullLiteral(node)) return parseNullLiteral(node)(state);
                if (tsm.Node.isNumericLiteral(node)) return parseNumericLiteral(node)(state);
                if (tsm.Node.isParenthesizedExpression(node)) return parseExpression(scope)(node.getExpression())(state);
                if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node)(state);
                // if (tsm.Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(node, scope);
                if (tsm.Node.isStringLiteral(node)) return parseStringLiteral(node)(state);
                if (tsm.Node.isTrueLiteral(node)) return parseBooleanLiteral(node)(state);
                return failState(node)(`parseExpression ${node.getKindName()}`)(state);
            }

export const parseArrayLiteral =
    (scope: Scope) =>
        (node: tsm.ArrayLiteralExpression): ExpressionParseState =>
            (state) => {

                const monoid = ROA.getMonoid<Operation>();
                let operations = monoid.empty;
                for (const e of node.getElements()) {
                    let ops = monoid.empty;
                    [ops, state] = parseExpression(scope)(e)(state);
                    operations = monoid.concat(operations, ops);
                }
                return [operations, state];
            }
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

export const parseBigIntLiteral =
    (node: tsm.BigIntLiteral): ExpressionParseState =>
        (state) => {
            const value = node.getLiteralValue() as bigint;
            const op: PushIntOperation = { kind: "pushint", value, location: node };
            return [[op], state];
        }

const binaryOpTokenMap: ReadonlyMap<tsm.SyntaxKind, OperationKind> = new Map([
    [tsm.SyntaxKind.AsteriskAsteriskToken, 'power'],
    [tsm.SyntaxKind.AsteriskToken, 'multiply'],
    [tsm.SyntaxKind.EqualsEqualsEqualsToken, 'equal'], // TODO: Should == and === be the same?
    [tsm.SyntaxKind.EqualsEqualsToken, 'equal'],
    [tsm.SyntaxKind.ExclamationEqualsToken, 'notequal'], // TODO: Should != and !== be the same?
    [tsm.SyntaxKind.ExclamationEqualsEqualsToken, 'notequal'],
    [tsm.SyntaxKind.GreaterThanEqualsToken, 'greaterthanorequal'],
    [tsm.SyntaxKind.GreaterThanToken, 'greaterthan'],
    [tsm.SyntaxKind.LessThanEqualsToken, 'lessthanorequal'],
    [tsm.SyntaxKind.LessThanToken, 'lessthan'],
    [tsm.SyntaxKind.PlusToken, 'add']
]);

export const parseBinaryExpression =
    (scope: Scope) =>
        (node: tsm.BinaryExpression): ExpressionParseState =>
            (state) => {
                const opToken = node.getOperatorToken();
                const opKind = binaryOpTokenMap.get(opToken.getKind());
                if (!opKind) {
                    return failState(node)(`parseBinaryExpression ${opToken.getKindName()}`)(state);
                }

                const left = parseExpression(scope)(node.getLeft())(state);
                const right = parseExpression(scope)(node.getRight())(left[1]);
                state = right[1];

                const monoid = ROA.getMonoid<Operation>();
                const operations = monoid.concat(left[0], right[0]).concat([{ kind: opKind }]);

                return [operations, state];
            }

export const parseBooleanLiteral =
    (node: tsm.FalseLiteral | tsm.TrueLiteral): ExpressionParseState =>
        (state) => {
            const value = node.getLiteralValue();
            const op: PushBoolOperation = { kind: "pushbool", value, location: node };
            return [[op], state];
        }

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

export const parseIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): ExpressionParseState =>
            (state) => {
                const symbol = node.getSymbol();
                if (!symbol) return failState(node)('undefined symbol')(state);
                const symbolDef = resolve(scope)(symbol);
                if (O.isNone(symbolDef)) 
                    return failState(node)(`unresolved symbol ${symbol.getName()}`)(state);
                if (isLoadableDef(symbolDef.value)) 
                    return [symbolDef.value.loadOperations, state];
                return failState(node)(`unknown symboldef ${symbol.getName()}`)(state);
            }

export const parseNullLiteral =
    (node: tsm.NullLiteral): ExpressionParseState =>
        (state) => {
            const op: Operation = { kind: "pushnull", location: node };
            return [[op], state];
        }

export const parseNumericLiteral =
    (node: tsm.NumericLiteral): ExpressionParseState =>
        (state) => {
            const value = node.getLiteralValue();
            if (Number.isInteger(value)) {
                const op: PushIntOperation = { kind: "pushint", value: BigInt(value), location: node };
                return [[op], state];
            }

            return failState(node)(`invalid non-integer numeric literal ${value}`)(state);
        }

const prefixUnaryOperatorMap: ReadonlyMap<tsm.SyntaxKind, OperationKind> = new Map([
    [tsm.SyntaxKind.ExclamationToken, 'not'],
    [tsm.SyntaxKind.MinusToken, 'negate']
]);

export const parsePrefixUnaryExpression = (scope: Scope) =>
    (node: tsm.PrefixUnaryExpression): ExpressionParseState =>
        (state) => {

            const opToken = node.getOperatorToken();
            const opKind = binaryOpTokenMap.get(opToken);
            if (!opKind) {
                return failState(node)(`parsePrefixUnaryExpression ${tsm.SyntaxKind[opToken]}`)(state);
            }

            const operand = parseExpression(scope)(node.getOperand())(state);

            const monoid = ROA.getMonoid<Operation>();
            const operations = monoid.concat(operand[0], [{ kind: opKind }]);
            state = operand[1];

            return [operations, state];
        }


// export function parsePropertyAccessExpression(node: tsm.PropertyAccessExpression, scope: ReadonlyScope): ParseExpressionResult {
//     return error('parsePropertyAccessExpression not impl', node);
// }


export const parseStringLiteral =
    (node: tsm.StringLiteral): ExpressionParseState =>
        (state) => {
            const literal = node.getLiteralValue();
            const value = Buffer.from(literal, 'utf8');
            const op: PushDataOperation = { kind: "pushdata", value, location: node };
            return [[op], state];
        }
