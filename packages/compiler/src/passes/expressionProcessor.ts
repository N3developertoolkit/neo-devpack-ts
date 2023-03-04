import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as TS from "../utility/TS";
import { Operation, SimpleOperationKind } from "../types/Operation";
import { resolve, Scope } from "../scope";
import { isCallableDef, isObjectDef, makeParseError, ObjectSymbolDef, ParseError, parseSymbol, SymbolDef } from "../symbolDef";

const resolveIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, SymbolDef> => {
            return pipe(
                node,
                parseSymbol(),
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

const makeCallChain =
    (node: tsm.Expression): RNEA.ReadonlyNonEmptyArray<tsm.Expression> => {
        const mcc =
            (chain: RNEA.ReadonlyNonEmptyArray<tsm.Expression>): RNEA.ReadonlyNonEmptyArray<tsm.Expression> => {
                const head = RNEA.head(chain);
                return tsm.Node.hasExpression(head)
                    ? mcc(ROA.prepend(head.getExpression())(chain))
                    : chain;
            }

        return mcc(RNEA.of<tsm.Expression>(node));
    }

const $resolve =
    (scope: Scope) =>
        (node: tsm.Expression) => {
            if (tsm.Node.isIdentifier(node)) return resolveIdentifier(scope)(node);
            return E.left(makeParseError(node)(`$resolve ${node.getKindName()} failed`))
        }
const parseCallChain =
    (scope: Scope) =>
        (chain: RNEA.ReadonlyNonEmptyArray<tsm.Expression>) => {

            let def = $resolve(scope)(RNEA.head(chain))
            let access: ReadonlyArray<Operation> = E.isRight(def)
                ? def.right.loadOperations ?? []
                : ROA.empty; 
            
            let tail = RNEA.tail(chain);

            while (E.right(def) && ROA.isNonEmpty(tail)) {
                const head = RNEA.head(tail);
                tail = RNEA.tail(tail);
                if (tsm.Node.isPropertyAccessExpression(head)) {

                } else if (tsm.Node.isCallExpression(head)) {

                } else {
                    return E.left(makeParseError(head)(`parseCallChain ${head.getKindName()} failed`))

                }

            }
        }

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

const getProp = ({ def, symbol }: {
    readonly symbol: tsm.Symbol;
    readonly def: ObjectSymbolDef;
}) => pipe(
    def.parseGetProp(symbol),
    E.fromOption(() =>
        makeParseError()(`invalid ${symbol.getName()} prop on ${def.symbol.getName()}`)
    )
)

const asObject = (def: SymbolDef) =>
    pipe(
        def,
        E.fromPredicate(
            isObjectDef,
            d => makeParseError()(`${d.symbol.getName()} is not an object`)
        )
    );


const asCallable = (def: SymbolDef) =>
    pipe(
        def,
        E.fromPredicate(
            isCallableDef,
            d => makeParseError()(`${d.symbol.getName()} is not callable`)
        )
    );


export const parseCallExpression =
    (scope: Scope) =>
        (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {


            const c2 = makeCallChain(node);
            parseCallChain(scope)(c2);

            // Callable objects take scope + node and return the operations for the args + the call
            // inside an Either. This enables certain callables to customize the argument parsing
            // (example: Uint8Array.from can convert an array into a bytestring). They are returned
            // as separate Operation arrays because any object navigation has to occur *between*
            // the args and the call. For example, Storage.context.get(key) needs to push:
            //      * the arguments
            //      * the storage get context syscall
            //      * the storage get syscall

            const chain = resolveCallChain(node);
            let access: ReadonlyArray<Operation> = ROA.empty;
            let def = resolveIdentifier(scope)(chain.head);
            let tail = chain.tail;
            while (E.isRight(def) && ROA.isNonEmpty(tail)) {
                const next = RNEA.head(tail);
                tail = RNEA.tail(tail);

                if (tsm.Node.isPropertyAccessExpression(next)) {
                    def = pipe(
                        next,
                        parseSymbol(),
                        E.bindTo('symbol'),
                        E.bind('def', () => pipe(def, E.chain(asObject))),
                        E.chain(getProp),
                        E.map(prop => {
                            access = ROA.concat(prop.access)(access);
                            return prop.value
                        })
                    );
                } else {
                    def = E.left(makeParseError(next)(`${next.getKindName()} not impl`));
                }
            }

            return pipe(
                def,
                E.chain(asCallable),
                E.chain(c => c.parseCall(node, scope)),
                E.map(c => M.concatAll(ROA.getMonoid<Operation>())([c.args, access, c.call]))
            )
        }


export const parseIdentifier =
    (scope: Scope) =>
        (node: tsm.Identifier): E.Either<ParseError, readonly Operation[]> => {
            return pipe(
                node,
                resolveIdentifier(scope),
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

export const parsePropertyAccessExpression =
    (scope: Scope) =>
        (node: tsm.PropertyAccessExpression): E.Either<ParseError, readonly Operation[]> => {

            const c2 = makeCallChain(node);
            parseCallChain(scope)(c2);

            const expr = node.getExpression();
            const type = expr.getType();
            const propName = node.getName();

            return pipe(
                expr,
                parseExpression(scope),
                E.bindTo('ops'),
                E.bind('index', () => pipe(
                    type.getProperties(),
                    ROA.findIndex(p => p.getName() === propName),
                    E.fromOption(() => makeParseError(node)(`failed to resolve ${propName} property`))
                )),
                E.map(({ index, ops }) => pipe(
                    ops,
                    ROA.concat([
                        { kind: 'pushint', value: BigInt(index) },
                        { kind: 'pickitem' }
                    ] as Operation[])
                ))
            )
        }

export const parseStringLiteral =
    (node: tsm.StringLiteral): E.Either<ParseError, Operation> => {
        const literal = node.getLiteralValue();
        const value = Buffer.from(literal, 'utf8');
        return E.right({ kind: "pushdata", value, location: node });
    }

const parseLiteral = <T>(func: (node: T) => E.Either<ParseError, Operation>) => (_scope: Scope) => flow(func, E.map(ROA.of));

const parseExpressioned = (scope: Scope) => (node: tsm.ExpressionedNode) => parseExpression(scope)(node.getExpression());

export type ExpressionNodeDispatchMap = {
    [TKind in tsm.SyntaxKind]?: (scope: Scope) => (node: tsm.KindToNodeMappings[TKind]) => E.Either<ParseError, ReadonlyArray<Operation>>
};

const map: ExpressionNodeDispatchMap = {
    [tsm.SyntaxKind.ArrayLiteralExpression]: parseArrayLiteral,
    [tsm.SyntaxKind.AsExpression]: parseExpressioned,
    [tsm.SyntaxKind.BigIntLiteral]: parseLiteral(parseBigIntLiteral),
    [tsm.SyntaxKind.BinaryExpression]: parseBinaryExpression,
    [tsm.SyntaxKind.CallExpression]: parseCallExpression,
    [tsm.SyntaxKind.FalseKeyword]: parseLiteral(parseBooleanLiteral),
    [tsm.SyntaxKind.Identifier]: parseIdentifier,
    [tsm.SyntaxKind.NonNullExpression]: parseExpressioned,
    [tsm.SyntaxKind.NullKeyword]: parseLiteral(parseNullLiteral),
    [tsm.SyntaxKind.NumericLiteral]: parseLiteral(parseNumericLiteral),
    [tsm.SyntaxKind.ParenthesizedExpression]: parseExpressioned,
    [tsm.SyntaxKind.PrefixUnaryExpression]: parsePrefixUnaryExpression,
    [tsm.SyntaxKind.PropertyAccessExpression]: parsePropertyAccessExpression,
    [tsm.SyntaxKind.StringLiteral]: parseLiteral(parseStringLiteral),
    [tsm.SyntaxKind.TrueKeyword]: parseLiteral(parseBooleanLiteral),
}

export const parseExpression =
    (scope: Scope) =>
        (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
            const kind = node.getKind();
            const func = map[kind];
            if (func) {
                return func(scope)(node as any);
            }
            return E.left(makeParseError(node)(`dispatch ${node.getKindName()} failed`))
        }


// export const parseExpression =
//     (scope: Scope) =>
//         (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {
//             if (tsm.Node.isArrayLiteralExpression(node)) return parseArrayLiteral(scope)(node);
//             if (tsm.Node.isAsExpression(node)) return parseExpression(scope)(node.getExpression());
//             if (tsm.Node.isBigIntLiteral(node)) return pipe(node, parseBigIntLiteral, E.map(ROA.of));
//             if (tsm.Node.isBinaryExpression(node)) return parseBinaryExpression(scope)(node);
//             if (tsm.Node.isCallExpression(node)) return parseCallExpression(scope)(node);
//             if (tsm.Node.isFalseLiteral(node)) return pipe(node, parseBooleanLiteral, E.map(ROA.of));
//             if (tsm.Node.isIdentifier(node)) return parseIdentifier(scope)(node);
//             if (tsm.Node.isNonNullExpression(node)) return parseExpression(scope)(node.getExpression());
//             if (tsm.Node.isNullLiteral(node)) return pipe(node, parseNullLiteral, E.map(ROA.of));
//             if (tsm.Node.isNumericLiteral(node)) return pipe(node, parseNumericLiteral, E.map(ROA.of));
//             if (tsm.Node.isParenthesizedExpression(node)) return parseExpression(scope)(node.getExpression());
//             if (tsm.Node.isPrefixUnaryExpression(node)) return parsePrefixUnaryExpression(scope)(node);
//             if (tsm.Node.isPropertyAccessExpression(node)) return parsePropertyAccessExpression(scope)(node);
//             if (tsm.Node.isStringLiteral(node)) return pipe(node, parseStringLiteral, E.map(ROA.of));
//             if (tsm.Node.isTrueLiteral(node)) return pipe(node, parseBooleanLiteral, E.map(ROA.of));

//             return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} not supported`));
//         }
