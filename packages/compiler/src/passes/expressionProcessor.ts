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
import { ConstantSymbolDef, isLoadableDef, makeParseError, ParseError, SymbolDef, VariableSymbolDef } from "../symbolDef";

// Shouldn't use the state monad for expression parsing. The only state expressions return is an ROA of parse errors.
// Instead, use Either, 

type ExpressionParseResult = E.Either<ParseError, ReadonlyArray<Operation>>

// const monoidEPR: M.Monoid<ExpressionParseResult> = {
//     empty: E.right([]),
//     concat: (x, y) => {





//         if (E.isLeft(x)) {
//             return E.isLeft(y) 
//                 ? E.left(ROA.concat(y.left)(x.left)) 
//                 : x;
//         } else {
//             return E.isRight(y) 
//                 ? E.right(ROA.concat(y.right)(x.right)) 
//                 : y;
//         }
//     }
// }


export const parseExpression =
    (scope: Scope) =>
        (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
            if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node);
            if (tsm.Node.isAsExpression(node)) return parseExpression(scope)(node.getExpression());
            if (tsm.Node.isBigIntLiteral(node)) return pipe(node, parseBigIntLiteral, E.map(ROA.of));
            if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node);
            // // if (tsm.Node.isCallExpression(node)) return parseCallExpression(node, scope);
            if (tsm.Node.isFalseLiteral(node)) return pipe(node, parseBooleanLiteral, E.map(ROA.of));
            if (tsm.Node.isIdentifier(node)) return parseIdentifier(scope)(node);
            if (tsm.Node.isNonNullExpression(node)) return parseExpression(scope)(node.getExpression());
            if (tsm.Node.isNullLiteral(node)) return pipe(node, parseNullLiteral, E.map(ROA.of));
            if (tsm.Node.isNumericLiteral(node)) return pipe(node, parseNumericLiteral, E.map(ROA.of));
            if (tsm.Node.isParenthesizedExpression(node)) return parseExpression(scope)(node.getExpression());
            if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node);
            // // if (tsm.Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(node, scope);
            if (tsm.Node.isStringLiteral(node)) return pipe(node, parseStringLiteral, E.map(ROA.of));
            if (tsm.Node.isTrueLiteral(node)) return pipe(node, parseBooleanLiteral, E.map(ROA.of));

            return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} not supported`));
        }

export const parseArrayLiteral =
    (scope: Scope) =>
        (node: tsm.ArrayLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node.getElements(),
                ROA.map(parseExpression(scope)),
                ROA.sequence(E.either),
                E.map(ROA.flatten)
            )
        }

export const parseBigIntLiteral =
    (node: tsm.BigIntLiteral): E.Either<ParseError, Operation> => {
        const value = node.getLiteralValue() as bigint;
        return E.right({ kind: "pushint", value, location: node });
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

export const parseBinaryOperatorToken =
    (node: tsm.Node<tsm.ts.BinaryOperatorToken>): E.Either<ParseError, Operation> => {
        return pipe(
            node.getKind(),
            binaryOpTokenMap.get,
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
        (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {
            const error = makeParseError(node);
            return pipe(
                node.getSymbol(),
                E.fromNullable(error('undefined symbol')),
                E.chain(symbol => pipe(
                    symbol,
                    resolve(scope),
                    E.fromOption(() => error(`unresolved symbol ${symbol.getName()}`))
                )),
                E.chain(flow(
                    E.fromPredicate(
                        isLoadableDef,
                        (def) => error(`${def.symbol.getName()} symbol not loadable`)))
                ),
                E.map(def => def.loadOperations)
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

const prefixUnaryOperatorMap: ReadonlyMap<tsm.SyntaxKind, OperationKind> = new Map([
    [tsm.SyntaxKind.ExclamationToken, 'not'],
    [tsm.SyntaxKind.MinusToken, 'negate']
]);

export const parseUnaryOperatorToken =
    (token: tsm.ts.PrefixUnaryOperator): E.Either<ParseError, Operation> => {
        return pipe(
            token,
            prefixUnaryOperatorMap.get,
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


// export function parsePropertyAccessExpression(node: tsm.PropertyAccessExpression, scope: ReadonlyScope): ParseExpressionResult {
//     return error('parsePropertyAccessExpression not impl', node);
// }


export const parseStringLiteral =
    (node: tsm.StringLiteral): E.Either<ParseError, Operation> => {
        const literal = node.getLiteralValue();
        const value = Buffer.from(literal, 'utf8');
        return E.right({ kind: "pushdata", value, location: node });
    }
