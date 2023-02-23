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

export const parseIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): ExpressionParseState =>
            (state) => {

                const error = makeParseError(node);
                return pipe(
                    node.getSymbol(),
                    E.fromNullable(error('undefined symbol')),
                    E.chain(symbol => pipe(
                        symbol,
                        resolve(scope),
                        E.fromOption(() => error(`unresolved symbol ${symbol.getName()}`))
                    )),
                    E.chain(def => isLoadableDef(def)
                        ? E.of(def.loadOperations)
                        : E.left(error(`unresolved symbol ${def.symbol.getName()}`))
                    ),
                    E.match(
                        error => [[], state.concat([error])],
                        ops => [ops, state]
                    )
                )
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
