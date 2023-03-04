import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as E from "fp-ts/Either";
import { Operation, SimpleOperationKind } from "../types/Operation";
import { resolve, Scope } from "../scope";
import { makeParseError, ObjectSymbolDef, ParseError, parseSymbol, SymbolDef } from "../symbolDef";
import { parseExpressionChain } from "./expressionChainProcessor";

export const parseArrayLiteral =
    (scope: Scope) =>
        (node: tsm.ArrayLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node.getElements(),
                ROA.map(parseExpression(scope)),
                ROA.sequence(E.Applicative),
                E.map(ROA.flatten)
            )
        }

export const parseBigIntLiteral =
    (node: tsm.BigIntLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue() as bigint;
        return E.right({ kind: "pushint", value, location: node });
    }

const binaryOpTokenMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
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

export const parseBinaryOperatorToken =
    (node: tsm.Node<tsm.ts.BinaryOperatorToken>): E.Either<ParseError, Operation> => {
        return pipe(
            node.getKind(),
            k => binaryOpTokenMap.get(k),
            E.fromNullable(
                makeParseError()(`parseBinaryOperatorToken ${node.getKindName()} not supported`)
            ),
            E.map(kind => ({ kind }) as Operation)
        );
    }

export const parseBinaryExpression =
    (scope: Scope) =>
        (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node.getOperatorToken(),
                parseBinaryOperatorToken,
                // map errors to reference the expression node 
                // instead of the token node
                E.mapLeft(e => makeParseError(node)(e.message)),
                E.chain(op => pipe(
                    node.getRight(),
                    parseExpression(scope),
                    E.map(
                        ROA.append(op)
                    )
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
    (node: tsm.FalseLiteral | tsm.TrueLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue();
        return E.right({ kind: "pushbool", value, location: node });
    }

export const parseIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                parseSymbol(),
                E.chain(symbol => pipe(
                    symbol,
                    resolve(scope),
                    E.fromOption(() => makeParseError(node)(`unresolved symbol ${symbol.getName()}`))
                )),
                E.map(s => s.loadOperations ?? [])
            );
        }

export const parseNullLiteral =
    (node: tsm.NullLiteral): E.Either<ParseError, Operation> =>
        E.right({ kind: "pushnull", location: node });

export const parseNumericLiteral =
    (node: tsm.NumericLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue();
        return Number.isInteger(value)
            ? E.right({ kind: "pushint", value: BigInt(value), location: node })
            : E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
    }

const prefixUnaryOperatorMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
    [tsm.SyntaxKind.ExclamationToken, 'not'],
    [tsm.SyntaxKind.MinusToken, 'negate']
]);

export const parseUnaryOperatorToken =
    (token: tsm.ts.PrefixUnaryOperator): E.Either<ParseError, Operation> => {
        return pipe(
            token,
            k => prefixUnaryOperatorMap.get(k),
            E.fromNullable(
                makeParseError()(`parseUnaryOperatorToken ${tsm.SyntaxKind[token]} not supported`)
            ),
            E.map(kind => ({ kind }) as Operation)
        );
    }

export const parsePrefixUnaryExpression = (scope: Scope) =>
    (node: tsm.PrefixUnaryExpression): E.Either<ParseError, readonly Operation[]> => {
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
    (node: tsm.StringLiteral): E.Either<ParseError, Operation> => {
        const literal = node.getLiteralValue();
        const value = Buffer.from(literal, 'utf8');
        return E.right({ kind: "pushdata", value, location: node });
    }

export const parseExpression =
    (scope: Scope) =>
        (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

            const parseLiteral =
                <T>(func: (node: T) => E.Either<ParseError, Operation>) =>
                    (_scope: Scope) => flow(func, E.map(ROA.of));

            if (tsm.Node.hasExpression(node)) return parseExpressionChain(scope)(node);
            if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node);
            if (tsm.Node.isBigIntLiteral(node)) return parseLiteral(parseBigIntLiteral)(scope)(node);
            if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node);
            if (tsm.Node.isFalseLiteral(node)) return parseLiteral(parseBooleanLiteral)(scope)(node);
            if (tsm.Node.isIdentifier(node)) return parseIdentifier(scope)(node);
            if (tsm.Node.isNullLiteral(node)) return parseLiteral(parseNullLiteral)(scope)(node);
            if (tsm.Node.isNumericLiteral(node)) return parseLiteral(parseNumericLiteral)(scope)(node);
            if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node);
            if (tsm.Node.isStringLiteral(node)) return parseLiteral(parseStringLiteral)(scope)(node);
            if (tsm.Node.isTrueLiteral(node)) return parseLiteral(parseBooleanLiteral)(scope)(node);
            return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} failed`))
        }
