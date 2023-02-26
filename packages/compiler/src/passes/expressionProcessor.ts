import * as tsm from "ts-morph";
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
import { Operation, SimpleOperationKind } from "../types/Operation";
import { resolve, Scope } from "../scope";
import { isCallableDef, isLoadableDef, makeParseError, ParseError, SymbolDef, VariableSymbolDef } from "../symbolDef";

const resolveIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, SymbolDef> => {
            return pipe(
                node.getSymbol(),
                O.fromNullable,
                E.fromOption(() => makeParseError(node)('undefined symbol')),
                E.chain(symbol => pipe(
                    symbol,
                    resolve(scope),
                    E.fromOption(() => makeParseError(node)(`unresolved symbol ${symbol.getName()}`))
                )),
            );
        }

const resolveCallChain =
    (node: tsm.CallExpression) => {
        let chain = RNEA.of<tsm.Expression>(node.getExpression());
        while (true) {
            const head = RNEA.head(chain);
            if (tsm.Node.isIdentifier(head)) return { head, tail: RNEA.tail(chain) };
            else if (tsm.Node.isPropertyAccessExpression(head)) {
                const expr: tsm.Expression = head.getExpression();
                chain = ROA.prepend(expr)(chain);
            }
            else {
                throw new Error(`parseCallChain ${head.getKindName()} not impl`);
            }
        }
    }

export const parseExpression =
    (scope: Scope) =>
        (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
            if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node);
            if (tsm.Node.isAsExpression(node)) return parseExpression(scope)(node.getExpression());
            if (tsm.Node.isBigIntLiteral(node)) return pipe(node, parseBigIntLiteral, E.map(ROA.of));
            if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node);
            if (tsm.Node.isCallExpression(node)) return parseCallExpression(scope)(node);
            if (tsm.Node.isFalseLiteral(node)) return pipe(node, parseBooleanLiteral, E.map(ROA.of));
            if (tsm.Node.isIdentifier(node)) return parseIdentifier(scope)(node);
            if (tsm.Node.isNonNullExpression(node)) return parseExpression(scope)(node.getExpression());
            if (tsm.Node.isNullLiteral(node)) return pipe(node, parseNullLiteral, E.map(ROA.of));
            if (tsm.Node.isNumericLiteral(node)) return pipe(node, parseNumericLiteral, E.map(ROA.of));
            if (tsm.Node.isParenthesizedExpression(node)) return parseExpression(scope)(node.getExpression());
            if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node);
            if (tsm.Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(scope)(node);
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


export const parseCallExpression =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {

            // Callable objects take scope + node and return the operations for the args + the call
            // inside an Either. This enables certain callables to customize the argument parsing
            // (example: Uint8Array.from can convert an array into a bytestring). They are returned
            // as separate Operation arrays because any object navigation has to occur *between*
            // the args and the call. For example, Storage.context.get(key) needs to push:
            //      * the arguments
            //      * the storage get context syscall
            //      * the storage get syscall

            const q = pipe(
                node,
                resolveCallChain,
                // temporary
                E.fromPredicate(
                    c => ROA.isEmpty(c.tail),
                    c => makeParseError(node)('parseCallExpression not impl for PropertyAccessExpression')
                ),
                E.chain(c => resolveIdentifier(scope)(c.head)),
                E.chain(E.fromPredicate(
                    isCallableDef,
                    c => makeParseError(node)(`${c.symbol.getName()} not callable`)
                )),
                E.chain(c => c.parseCall(node, scope))
            )

            return E.left(makeParseError(node)('parseCallExpression not impl'));
        }


export const parseIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {
            const error = makeParseError(node);
            return pipe(
                node,
                resolveIdentifier(scope),
                E.chain(flow(
                    E.fromPredicate(
                        isLoadableDef,
                        (def) => makeParseError(node)(`${def.symbol.getName()} symbol not loadable`)))
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

export const parsePropertyAccessExpression =
    (scope: Scope) =>
        (node: tsm.PropertyAccessExpression): E.Either<ParseError, readonly Operation[]> => {
            return E.left(makeParseError(node)('parsePropertyAccessExpression not impl'));
        }

export const parseStringLiteral =
    (node: tsm.StringLiteral): E.Either<ParseError, Operation> => {
        const literal = node.getLiteralValue();
        const value = Buffer.from(literal, 'utf8');
        return E.right({ kind: "pushdata", value, location: node });
    }
