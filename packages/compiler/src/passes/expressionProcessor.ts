import { ArrayLiteralExpression, BigIntLiteral, SyntaxKind, Node, ts, BinaryExpression, FalseLiteral, TrueLiteral, Identifier, NullLiteral, NumericLiteral, PrefixUnaryExpression, StringLiteral, Expression } from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import { Operation, SimpleOperationKind } from "../types/Operation";
import { resolve, Scope } from "../scope";
import { ParseError, SymbolDef } from "../symbolDef";
import { parseExpressionChain } from "./expressionChainProcessor";
import { makeParseError, parseSymbol } from "./processSourceFile";

export const parseArrayLiteral =
    (scope: Scope) =>
        (node: ArrayLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
            // TODO: this doesn't seem right. SHouldn't there be a newarray op here?
            return pipe(
                node.getElements(),
                ROA.map(parseExpression(scope)),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten)
            )
        }

export const parseBigIntLiteral =
    (node: BigIntLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue() as bigint;
        return E.right({ kind: "pushint", value, location: node });
    }

const binaryOpTokenMap: ReadonlyMap<SyntaxKind, SimpleOperationKind> = new Map([
    [SyntaxKind.AsteriskAsteriskToken, 'power'],
    [SyntaxKind.AsteriskToken, 'multiply'],
    [SyntaxKind.EqualsEqualsEqualsToken, 'equal'], // TODO: Should == and === be the same?
    [SyntaxKind.EqualsEqualsToken, 'equal'],
    [SyntaxKind.ExclamationEqualsToken, 'notequal'], // TODO: Should != and !== be the same?
    [SyntaxKind.ExclamationEqualsEqualsToken, 'notequal'],
    [SyntaxKind.GreaterThanEqualsToken, 'greaterthanorequal'],
    [SyntaxKind.GreaterThanToken, 'greaterthan'],
    [SyntaxKind.LessThanEqualsToken, 'lessthanorequal'],
    [SyntaxKind.LessThanToken, 'lessthan'],
    [SyntaxKind.PlusToken, 'add'] 
]);

export const parseBinaryOperatorToken =
    (node: Node<ts.BinaryOperatorToken>): E.Either<ParseError, Operation> => {
        return pipe(
            node.getKind(),
            k => binaryOpTokenMap.get(k),
            E.fromNullable(
                makeParseError(node)(`parseBinaryOperatorToken ${node.getKindName()} not supported`)
            ),
            E.map(kind => ({ kind }) as Operation)
        );
    }

export const parseBinaryExpression =
    (scope: Scope) =>
        (node: BinaryExpression): E.Either<ParseError, readonly Operation[]> => {
            // TODO:  if left and right are strings, PlusToken op should be concat instead of add
            return pipe(
                node.getOperatorToken(),
                parseBinaryOperatorToken,
                // map errors to reference the expression node 
                E.mapLeft(e => makeParseError(node)(e.message)),
                E.chain(op => pipe(
                    node.getRight(),
                    parseExpression(scope),
                    E.map(ROA.append(op))
                )),
                E.chain(ops => pipe(
                    node.getLeft(),
                    parseExpression(scope),
                    E.map(
                        ROA.concat(ops)
                    )
                )),
            )
        }

export const parseBooleanLiteral =
    (node: FalseLiteral | TrueLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue();
        return E.right({ kind: "pushbool", value, location: node });
    }

export const parseIdentifier =
    (scope: Scope) =>
        (node: Identifier): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                parseSymbol,
                E.chain(symbol => pipe(
                    symbol,
                    resolve(scope),
                    E.fromOption(() => makeParseError(node)(`unresolved symbol ${symbol.getName()}`))
                )),
                E.map(def => def.loadOps ?? [])
            );
        }

export const parseNullLiteral =
    (node: NullLiteral): E.Either<ParseError, Operation> =>
        E.right({ kind: "pushnull", location: node });

export const parseNumericLiteral =
    (node: NumericLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue();
        return Number.isInteger(value)
            ? E.right({ kind: "pushint", value: BigInt(value), location: node })
            : E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
    }

const prefixUnaryOperatorMap: ReadonlyMap<SyntaxKind, SimpleOperationKind> = new Map([
    [SyntaxKind.ExclamationToken, 'not'],
    [SyntaxKind.MinusToken, 'negate']
]);

export const parseUnaryOperatorToken =
    (token: ts.PrefixUnaryOperator): E.Either<ParseError, Operation> => {
        return pipe(
            token,
            k => prefixUnaryOperatorMap.get(k),
            E.fromNullable(
                makeParseError()(`parseUnaryOperatorToken ${SyntaxKind[token]} not supported`)
            ),
            E.map(kind => ({ kind }) as Operation)
        );
    }

export const parsePrefixUnaryExpression = (scope: Scope) =>
    (node: PrefixUnaryExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node.getOperatorToken(),
            parseUnaryOperatorToken,
            // map errors to reference the expression node 
            E.mapLeft(e => makeParseError(node)(e.message)),
            E.chain(op => pipe(
                node.getOperand(),
                parseExpression(scope),
                E.map(
                    ROA.append(op)
                )
            ))
        )
    }

export const parseStringLiteral =
    (node: StringLiteral): E.Either<ParseError, Operation> => {
        const literal = node.getLiteralValue();
        const value = Buffer.from(literal, 'utf8');
        return E.right({ kind: "pushdata", value, location: node });
    }

export const parseExpression =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, readonly Operation[]> => {

            if (Node.hasExpression(node)) return parseExpressionChain(scope)(node);
            if (Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node);
            if (Node.isBigIntLiteral(node)) return parseLiteral(parseBigIntLiteral)(node);
            if (Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node);
            if (Node.isFalseLiteral(node)) return parseLiteral(parseBooleanLiteral)(node);
            if (Node.isIdentifier(node)) return parseIdentifier(scope)(node);
            if (Node.isNullLiteral(node)) return parseLiteral(parseNullLiteral)(node);
            if (Node.isNumericLiteral(node)) return parseLiteral(parseNumericLiteral)(node);
            if (Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node);
            if (Node.isStringLiteral(node)) return parseLiteral(parseStringLiteral)(node);
            if (Node.isTrueLiteral(node)) return parseLiteral(parseBooleanLiteral)(node);
            return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} failed`))

            function parseLiteral<T>(func: (node: T) => E.Either<ParseError, Operation>) {
                return flow(func, E.map(ROA.of));
            }
        }
