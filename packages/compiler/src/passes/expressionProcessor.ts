import * as tsm from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'
import * as TS from "../TS";
import { isJumpTargetOp, Operation, pushInt, pushString, SimpleOperationKind } from "../types/Operation";
import { CompileTimeObject, Scope, resolve, resolveType } from "../types/CompileTimeObject";
import { ParseError, isBigIntLike, isBooleanLike, isNumberLike, isStringLike, makeParseError } from "../utils";

export const parseBigIntLiteral =
    (node: tsm.BigIntLiteral): E.Either<ParseError, readonly Operation[]> => {
        const value = node.getLiteralValue() as bigint;
        return pipe(value, pushInt, ROA.of, E.of);
    }

export const parseBooleanLiteral =
    (node: tsm.FalseLiteral | tsm.TrueLiteral): E.Either<ParseError, readonly Operation[]> => {
        const value = node.getLiteralValue();
        return pipe(<Operation>{ kind: "pushbool", value }, ROA.of, E.of);
    }

export const parseNullLiteral =
    (_node: tsm.Node): E.Either<ParseError, readonly Operation[]> =>
        pipe(<Operation>{ kind: "pushnull" }, ROA.of, E.of);


export const parseNumericLiteral =
    (node: tsm.NumericLiteral): E.Either<ParseError, readonly Operation[]> => {
        const value = node.getLiteralValue();
        return Number.isInteger(value)
            ? pipe(value, pushInt, ROA.of, E.of)
            : E.left(makeParseError(node)(`invalid non-integer numeric literal ${value}`));
    }

export const parseStringLiteral =
    (node: tsm.StringLiteral): E.Either<ParseError, readonly Operation[]> => {
        const literal = node.getLiteralValue();
        return pipe(literal, pushString, ROA.of, E.of);
    }

export const parseCallExpression =
    (scope: Scope) => (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node.getExpression(),
            resolveExpression(scope),
            O.chain(cto => O.fromNullable(cto.parseCall)),
            E.fromOption(() => makeParseError(node)(`parseCall not available for ${node.getExpression().print()}`)),
            E.chain(parseCall => parseCall(scope)(node))
        )
    }

export const parsePropertyAccessExpression =
    (scope: Scope) => (node: tsm.PropertyAccessExpression): E.Either<ParseError, readonly Operation[]> => {
        return pipe(
            node, 
            resolvePropertyAccessExpression(scope),
            O.chain(cto => {
                return O.fromNullable(cto.loadOps);
            }),
            E.fromOption(() => makeParseError(node)(`loadOps not available for ${node.getExpression().print()}`)),
        );
    }
export function parseExpression(scope: Scope) {
    return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

        switch (node.getKind()) {
            case tsm.SyntaxKind.BigIntLiteral: return parseBigIntLiteral(node as tsm.BigIntLiteral);
            case tsm.SyntaxKind.CallExpression: return parseCallExpression(scope)(node as tsm.CallExpression);
            case tsm.SyntaxKind.FalseKeyword: return parseBooleanLiteral(node as tsm.FalseLiteral);
            case tsm.SyntaxKind.NullKeyword: return parseNullLiteral(node);
            case tsm.SyntaxKind.NumericLiteral: return parseNumericLiteral(node as tsm.NumericLiteral);
            case tsm.SyntaxKind.PropertyAccessExpression: return parsePropertyAccessExpression(scope)(node as tsm.PropertyAccessExpression);
            case tsm.SyntaxKind.StringLiteral: return parseStringLiteral(node as tsm.StringLiteral);
            case tsm.SyntaxKind.TrueKeyword: return parseBooleanLiteral(node as tsm.TrueLiteral);

            default:
                return E.left(makeParseError(node)(`parseExpression ${node.getKindName()} not impl`));
        };
    }
}

function resolveIdentifier(scope: Scope) {
    return (node: tsm.Identifier): O.Option<CompileTimeObject> => {
        return pipe(
            node,
            TS.getSymbol,
            O.chain(resolve(scope))
        );
    };
}

function resolvePropertyAccessExpression(scope: Scope) {
    return (node: tsm.PropertyAccessExpression): O.Option<CompileTimeObject> => {
        const expr = node.getExpression();
        return pipe(
            node,
            // first, get the property symbol
            TS.getSymbol,
            O.chain(symbol => pipe(
                // next, try and resolve the property on the CTO directly
                expr,
                resolveExpression(scope),
                O.chain(getProperty(symbol)),
                // Finally, if the CTO doesn't contain the property,
                // try and resolve the property on the expression's type CTO
                O.alt(() => pipe(
                    expr.getType(),
                    TS.getTypeSymbol,
                    O.chain(q => {
                        return resolveType(scope)(q);
                    }),
                    O.chain(getProperty(symbol))
                ))
            )),
        );
    }

    function getProperty(symbol: tsm.Symbol) {
        return (cto: CompileTimeObject): O.Option<CompileTimeObject> => {
            return pipe(
                cto.getProperty,
                O.fromNullable,
                O.chain(getProperty => getProperty(symbol))
            )
        }
    }
}

    // function resolveProperty(ctx: ChainContext) {
    //     return (node: tsm.PropertyAccessExpression): E.Either<ParseError, CompileTimeObject> => {
    //         return pipe(
    //             node,
    //             TS.parseSymbol,
    //             E.bindTo('symbol'),
    //             E.bind('typeDef', () => {

    //                 const type = ctx.currentType ?? ctx.current?.node.getType();
    //                 const symbol = type?.getSymbol();
    //                 const resolved = symbol ? resolveType(ctx.scope)(symbol) : O.none;
    //                 return pipe(
    //                     ctx.currentType,
    //                     O.fromNullable,
    //                     O.alt(() => pipe(ctx.current?.node.getType(), O.fromNullable)),
    //                     O.chain(TS.getTypeSymbol),
    //                     O.chain(resolveType(ctx.scope)),
    //                     O.toUndefined,
    //                     E.of<ParseError, CompileTimeObject | undefined>
    //                 );
    //             }),
    //             E.chain(({ symbol, typeDef }) => {
    //                 return pipe(
    //                     getProp(ctx.current, symbol),
    //                     O.alt(() => getProp(typeDef, symbol)),
    //                     E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} property`))
    //                 )
    //             })
    //         );
    //     };

    //     function getProp(cto: CompileTimeObject | undefined, symbol: tsm.Symbol): O.Option<CompileTimeObject> {
    //         return cto && cto.getProperty ? cto.getProperty(symbol) : O.none;
    //     }
    // }

    export function resolveExpression(scope: Scope) {
        return (node: tsm.Expression): O.Option<CompileTimeObject> => {

            switch (node.getKind()) {
                case tsm.SyntaxKind.Identifier: return resolveIdentifier(scope)(node as tsm.Identifier);
                case tsm.SyntaxKind.PropertyAccessExpression: return resolvePropertyAccessExpression(scope)(node as tsm.PropertyAccessExpression);
            };

            return O.none;
        };
    }


// type DispatchMap<T> = {
//     [TKind in tsm.SyntaxKind]?: (node: tsm.KindToNodeMappings[TKind]) => E.Either<ParseError, T>;
// };



// const $resolve =
//     (node: tsm.Node) =>
//         (scope: Scope) =>
//             (symbol: tsm.Symbol): E.Either<ParseError, CompileTimeObject> => {
//                 return pipe(
//                     symbol,
//                     resolve(scope),
//                     E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} symbol`))
//                 )
//             }

// const parseArguments = (scope: Scope) => (node: tsm.CallExpression) => {
//     return pipe(
//         node,
//         TS.getArguments,
//         ROA.map(parseExpression(scope)),
//         ROA.sequence(E.Applicative),
//         E.map(ROA.reverse),
//         E.map(ROA.flatten),
//     );
// }

// export const parseArrayLiteral =
//     (scope: Scope) =>
//         (node: tsm.ArrayLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
//             const elements = node.getElements();
//             return pipe(
//                 elements,
//                 ROA.map(parseExpression(scope)),
//                 ROA.sequence(E.Applicative),
//                 E.map(ROA.flatten),
//                 E.map(ROA.concat([
//                     { kind: "pushint", value: BigInt(elements.length) },
//                     { kind: 'packarray' },
//                 ] as readonly Operation[])),
//             )
//         }


// function parseNullishCoalescingExpression(node: tsm.BinaryExpression, scope: Scope) {
//     const endTarget = { kind: "noop" } as Operation;
//     return pipe(
//         node.getLeft(),
//         parseExpression(scope),
//         E.map(ROA.concat([
//             { kind: "duplicate" },
//             { kind: "isnull" },
//             { kind: "jumpifnot", target: endTarget },
//             { kind: "drop" }
//         ] as Operation[])),
//         E.chain(ops => pipe(
//             node.getRight(),
//             parseExpression(scope),
//             E.map(right => ROA.concat(right)(ops))
//         )),
//         E.map(ROA.append(endTarget))
//     )
// }

// function parseLogicalExpression(node: tsm.BinaryExpression, scope: Scope, isOrOperation: boolean) {
//     // logical expressions coerce left and right expressions to boolean
//     const endTarget = { kind: "noop" } as Operation;

//     const jumpKind = isOrOperation ? "jumpifnot" : "jumpif";
//     return pipe(
//         node.getLeft(),
//         parseExpressionAsBoolean(scope),
//         E.map(ROA.concat([
//             { kind: jumpKind, offset: 3 },
//             { kind: "pushbool", value: isOrOperation },
//             { kind: "jump", target: endTarget },
//             { kind: "noop" }
//         ] as Operation[])),
//         E.chain(ops => pipe(
//             node.getRight(),
//             parseExpressionAsBoolean(scope),
//             E.map(right => ROA.concat(right)(ops))
//         )),
//         E.map(ROA.append(endTarget))
//     );
// }

// const parseStoreSymbol = (node: tsm.Expression) => (context: ChainContext): E.Either<ParseError, [ChainContext, CompileTimeObject]> => {
//     if (tsm.Node.isIdentifier(node))
//         return pipe(
//             node,
//             TS.parseSymbol,
//             E.chain($resolve(node)(context.scope)),
//             E.map(def => [context, def])
//         );

//     if (tsm.Node.isElementAccessExpression(node)) {
//         const q = pipe(
//             node.getArgumentExpression(),
//             E.fromNullable(makeParseError(node)('element access expression must have argument expression')),
//             E.chain(parseExpression(context.scope)),
//         )
//         const ops = parseExpression(context.scope)(node.getArgumentExpressionOrThrow());
//     }
//     if (tsm.Node.isPropertyAccessExpression(node))
//         return pipe(
//             node,
//             resolveProperty(context),
//             E.map(def => [context, def])
//         );
//     return E.left(makeParseError(node)(`parseStore ${node.getKindName()} not impl`));
// }

// // need to think thru this a bit more for assignment
// // variable = something
// // obj.prop = something
// // obj.subObj.prop = something
// // obj.array[index] = something
// // array[index] = something
// // array[index].prop = something
// // [value1, value2] = someArray
// // { prop1, prop2 } = someObject
// // { prop1: value1, prop2: value2 } = someObject

// // currently, parseStore has two args:
// //  * loadOps (the ops needed to load the parent of the value being assigned)
// //  * valueOps (the ops of the value being assigned)
// //

// // const makeAssignment = (node: tsm.Expression, scope: Scope) => (valueOps: readonly Operation[]) => {
// //     return pipe(
// //         node,
// //         makeExpressionChain,
// //         RNEA.matchRight((init, last) => {
// //             return pipe(
// //                 init,
// //                 reduceChain(scope),
// //                 E.chain(parseStoreSymbol(last)),
// //                 E.chain(([context, def]) => {
// //                     if (def.parseStore) {
// //                         return def.parseStore(context.operations, valueOps);
// //                     } else {
// //                         return E.left(makeParseError(node)('parseStore not implemented'))
// //                     }
// //                 })
// //             );
// //         }),
// //     )
// // }

// const binaryOpTokenMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
//     [tsm.SyntaxKind.AmpersandToken, "and"],
//     [tsm.SyntaxKind.AsteriskAsteriskToken, 'power'],
//     [tsm.SyntaxKind.AsteriskToken, 'multiply'],
//     [tsm.SyntaxKind.BarToken, 'or'],
//     [tsm.SyntaxKind.EqualsEqualsEqualsToken, 'equal'], // TODO: Should == and === be different?
//     [tsm.SyntaxKind.EqualsEqualsToken, 'equal'],
//     [tsm.SyntaxKind.ExclamationEqualsToken, 'notequal'], // TODO: Should != and !== be different?
//     [tsm.SyntaxKind.ExclamationEqualsEqualsToken, 'notequal'],
//     [tsm.SyntaxKind.GreaterThanEqualsToken, 'greaterthanorequal'],
//     [tsm.SyntaxKind.GreaterThanToken, 'greaterthan'],
//     [tsm.SyntaxKind.LessThanEqualsToken, 'lessthanorequal'],
//     [tsm.SyntaxKind.LessThanToken, 'lessthan'],
//     [tsm.SyntaxKind.PlusToken, 'add']
// ]);

// // SlashEqualsToken = 68, DIV
// // PercentEqualsToken = 69, MOD
// // LessThanLessThanEqualsToken = 70, SHL
// // GreaterThanGreaterThanEqualsToken = 71, SHR
// // GreaterThanGreaterThanGreaterThanEqualsToken = 72, ???
// // AmpersandEqualsToken = 73, AND/BOOLAND
// // BarEqualsToken = 74, OR/BOOLOR
// // BarBarEqualsToken = 75, BOOLOR
// // AmpersandAmpersandEqualsToken = 76, BOOLAND
// // QuestionQuestionEqualsToken = 77, CoalesceAssignment
// // CaretEqualsToken = 78, XOR

// const compoundAssignmentTokenMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
//     [tsm.SyntaxKind.AsteriskAsteriskEqualsToken, 'power'],
//     [tsm.SyntaxKind.AsteriskEqualsToken, 'multiply'],
//     [tsm.SyntaxKind.MinusEqualsToken, 'subtract'],
//     [tsm.SyntaxKind.PlusEqualsToken, 'add']
// ]);

// const compoundAssignmentOperatorMap = new Map<tsm.SyntaxKind, tsm.ts.BinaryOperator>([
//     [tsm.SyntaxKind.PlusEqualsToken, tsm.ts.SyntaxKind.PlusToken],
//     [tsm.SyntaxKind.MinusEqualsToken, tsm.SyntaxKind.MinusToken],
//     [tsm.SyntaxKind.AsteriskAsteriskEqualsToken, tsm.SyntaxKind.AsteriskAsteriskToken],
//     [tsm.SyntaxKind.AsteriskEqualsToken, tsm.SyntaxKind.AsteriskToken],
//     [tsm.SyntaxKind.SlashEqualsToken, tsm.SyntaxKind.SlashToken],
//     [tsm.SyntaxKind.PercentEqualsToken, tsm.SyntaxKind.PercentToken],
//     [tsm.SyntaxKind.AmpersandEqualsToken, tsm.SyntaxKind.AmpersandToken],
//     [tsm.SyntaxKind.BarEqualsToken, tsm.SyntaxKind.BarToken],
//     [tsm.SyntaxKind.CaretEqualsToken, tsm.SyntaxKind.CaretToken],
//     [tsm.SyntaxKind.LessThanLessThanEqualsToken, tsm.SyntaxKind.LessThanLessThanToken],
//     [tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, tsm.SyntaxKind.GreaterThanGreaterThanGreaterThanToken],
//     [tsm.SyntaxKind.GreaterThanGreaterThanEqualsToken, tsm.SyntaxKind.GreaterThanGreaterThanToken],
//     [tsm.SyntaxKind.BarBarEqualsToken, tsm.SyntaxKind.BarBarToken],
//     [tsm.SyntaxKind.AmpersandAmpersandEqualsToken, tsm.SyntaxKind.AmpersandAmpersandToken],
//     [tsm.SyntaxKind.QuestionQuestionEqualsToken, tsm.SyntaxKind.QuestionQuestionToken],
// ]) as ReadonlyMap<tsm.SyntaxKind, tsm.ts.BinaryOperator>;

// export const parseBinaryExpression =
//     (scope: Scope) =>
//         (node: tsm.BinaryExpression): E.Either<ParseError, readonly Operation[]> => {

//             const opToken = node.getOperatorToken().getKind();
//             if (opToken === tsm.SyntaxKind.AmpersandAmpersandToken) {
//                 return parseLogicalExpression(node, scope, false);
//             }
//             if (opToken === tsm.SyntaxKind.BarBarToken) {
//                 return parseLogicalExpression(node, scope, true);
//             }
//             if (opToken === tsm.SyntaxKind.QuestionQuestionToken) {
//                 return parseNullishCoalescingExpression(node, scope);
//             }
//             // if (opToken === tsm.SyntaxKind.EqualsToken) {
//             //     return pipe(
//             //         node.getRight(),
//             //         parseExpression(scope),
//             //         E.chain(makeAssignment(node.getLeft(), scope)),
//             //     )
//             // }

//             // const compoundAssignmentOpKind = compoundAssignmentTokenMap.get(opToken);
//             // if (compoundAssignmentOpKind) {
//             //     const left = node.getLeft();
//             //     return pipe(
//             //         node.getRight(),
//             //         parseExpression(scope),
//             //         E.chain(ops => pipe(
//             //             left,
//             //             parseExpression(scope),
//             //             E.map(ROA.concat(ops))
//             //         )),
//             //         E.map(ROA.append({ kind: compoundAssignmentOpKind } as Operation)),
//             //         E.map(ROA.append({ kind: 'duplicate' } as Operation)),
//             //         E.chain(makeAssignment(left, scope)),
//             //     )
//             // }

//             const binaryOpKind = binaryOpTokenMap.get(opToken);
//             if (binaryOpKind) {
//                 return pipe(
//                     node.getRight(),
//                     parseExpression(scope),
//                     E.chain(right => pipe(
//                         node.getLeft(),
//                         parseExpression(scope),
//                         E.map(ROA.concat(right))
//                     )),
//                     E.map(ROA.append({ kind: binaryOpKind } as Operation)),
//                     E.map(ROA.append({ kind: 'duplicate' } as Operation)),
//                 )
//             }

//             return E.left(makeParseError(node)(`parseBinaryExpression ${node.getOperatorToken().getKindName()} not supported`))
//         }


// export function makeConditionalExpression({ condition, whenTrue, whenFalse }: {
//     condition: readonly Operation[];
//     whenTrue: readonly Operation[];
//     whenFalse: readonly Operation[];
// }): readonly Operation[] {

//     const falseTarget: Operation = { kind: "noop" };
//     const endTarget: Operation = { kind: "noop" };
//     return pipe(
//         condition,
//         ROA.append({ kind: 'jumpifnot', target: falseTarget } as Operation),
//         ROA.concat(whenTrue),
//         ROA.append({ kind: 'jump', target: endTarget } as Operation),
//         ROA.append(falseTarget as Operation),
//         ROA.concat(whenFalse),
//         ROA.append(endTarget as Operation)
//     );
// }

// export const parseConditionalExpression =
//     (scope: Scope) =>
//         (node: tsm.ConditionalExpression): E.Either<ParseError, readonly Operation[]> => {
//             return pipe(
//                 node.getCondition(),
//                 parseExpressionAsBoolean(scope),
//                 E.bindTo('condition'),
//                 E.bind("whenTrue", () => pipe(node.getWhenTrue(), parseExpression(scope))),
//                 E.bind("whenFalse", () => pipe(node.getWhenFalse(), parseExpression(scope))),
//                 E.map(makeConditionalExpression)
//             )
//         }



// const prefixUnaryOperatorMap: ReadonlyMap<tsm.SyntaxKind, SimpleOperationKind> = new Map([
//     [tsm.SyntaxKind.MinusToken, 'negate']
// ]);

// export const parsePrefixUnaryOperatorToken =
//     (token: tsm.ts.PrefixUnaryOperator): E.Either<ParseError, Operation> => {
//         return pipe(
//             token,
//             k => prefixUnaryOperatorMap.get(k),
//             E.fromNullable(
//                 makeParseError()(`parseUnaryOperatorToken ${tsm.SyntaxKind[token]} not supported`)
//             ),
//             E.map(kind => ({ kind }) as Operation)
//         );
//     }

// export const parsePrefixUnaryExpression = (scope: Scope) =>
//     (node: tsm.PrefixUnaryExpression): E.Either<ParseError, readonly Operation[]> => {
//         const token = node.getOperatorToken();

//         if (token === tsm.SyntaxKind.ExclamationToken) {
//             // logical "not" coerces to boolean
//             return pipe(
//                 node.getOperand(),
//                 parseExpressionAsBoolean(scope),
//                 E.map(ROA.append({ kind: "not" } as Operation))
//             )
//         }
//         return pipe(
//             node.getOperatorToken(),
//             parsePrefixUnaryOperatorToken,
//             // map errors to reference the expression node
//             E.mapLeft(e => makeParseError(node)(e.message)),
//             E.chain(op => pipe(
//                 node.getOperand(),
//                 parseExpression(scope),
//                 E.map(
//                     ROA.append(op)
//                 )
//             ))
//         )
//     }

// const parseObjectLiteralProperty =
//     (scope: Scope) =>
//         (prop: tsm.ObjectLiteralElementLike): E.Either<ParseError, readonly Operation[]> => {
//             const makeError = makeParseError(prop);

//             if (tsm.Node.isPropertyAssignment(prop)) {
//                 return pipe(
//                     prop.getInitializer(),
//                     E.fromNullable(makeError("invalid initializer")),
//                     E.chain(parseExpression(scope)),
//                 )
//             }

//             if (tsm.Node.isShorthandPropertyAssignment(prop)) {
//                 return pipe(
//                     prop.getObjectAssignmentInitializer(),
//                     E.fromPredicate(
//                         init => !init,
//                         () => makeParseError(prop)(`shorthand initializer not supported`)
//                     ),
//                     E.chain(() => TS.parseSymbol(prop)),
//                     E.chain($resolve(prop)(scope)),
//                     E.chain(def => def.loadOps
//                         ? E.of(def.loadOps)
//                         : E.left(makeError(`${def.symbol.getName()} invalid load ops}`))
//                     )
//                 )
//             }

//             return E.left(makeError(`parseObjectLiteralProperty ${prop.getKindName()} not impl`))
//         }

// export const parseObjectLiteralExpression =
//     (scope: Scope) => (node: tsm.ObjectLiteralExpression): E.Either<ParseError, readonly Operation[]> => {
//         const props = node.getProperties();
//         return pipe(
//             props,
//             ROA.map(prop => {
//                 return pipe(
//                     prop,
//                     parseObjectLiteralProperty(scope),
//                     E.bindTo('value'),
//                     E.bind('key', () => pipe(
//                         prop,
//                         TS.parseSymbol,
//                         E.map(s => parseString(s.getName()))
//                     )),
//                     E.map(({ key, value }) => ROA.append(key)(value))
//                 );
//             }),
//             ROA.sequence(E.Applicative),
//             E.map(ROA.flatten),
//             E.map(ROA.concat([
//                 { kind: "pushint", value: BigInt(props.length) },
//                 { kind: 'packmap' },
//             ] as readonly Operation[])),
//         );
//     }

// function parseString(value: string): Operation {
//     const buffer = Buffer.from(value, 'utf8');
//     return { kind: 'pushdata', value: buffer };
// }

// export const parseStringLiteral =
//     (node: tsm.StringLiteral): E.Either<ParseError, Operation> => {
//         const literal = node.getLiteralValue();
//         return E.of(parseString(literal));
//     }



// // TS inherits JS's odd concept of truthy/falsy. As such, this method include code to
// // convert an Expression to be boolean typed (as per JS boolean coercion rules)
// export function parseExpressionAsBoolean(scope: Scope) {
//     return (node: tsm.Expression): E.Either<ParseError, readonly Operation[]> => {

//         const parseResult = parseExpression(scope)(node);
//         const type = node.getType();

//         // boolean experessions don't need to be converted
//         if (isBooleanLike(type)) return parseResult;

//         // numeric expressions are converted by comparing value to zero
//         if (isBigIntLike(type) || isNumberLike(type)) {

//             const convertOps: Operation[] = [
//                 { kind: 'pushint', value: 0n },
//                 { kind: 'equal' },
//             ]
//             return pipe(parseResult, E.map(ROA.concat(convertOps)))
//         }

//         const resolvedType = pipe(
//             type,
//             TS.getTypeSymbol,
//             O.chain(resolveType(scope)),
//         )

//         const matchTypeName = (name: string) => pipe(
//             resolvedType,
//             O.map(s => s.symbol.getName() === name),
//             O.getOrElse(() => false)
//         )

//         // convert bytestring to boolean by comparing to null and comparing length to zero
//         if (isStringLike(type) || matchTypeName("ByteString")) {
//             const convertOps: Operation[] = [
//                 { kind: 'duplicate' },
//                 { kind: 'isnull' },
//                 { kind: "jumpifnot", offset: 3 },
//                 { kind: 'pushbool', value: true },
//                 { kind: "jump", offset: 4 },
//                 { kind: 'size' },
//                 { kind: 'pushint', value: 0n },
//                 { kind: 'notequal' },
//                 { kind: 'noop' }
//             ]

//             return pipe(parseResult, E.map(ROA.concat(convertOps)))
//         }

//         // convert other objects by comparing to null
//         if (O.isSome(resolvedType) && "getProperty" in resolvedType.value) {
//             const convertOps: Operation[] = [
//                 { kind: 'isnull' },
//                 { kind: "not" },
//             ]
//             return pipe(parseResult, E.map(ROA.concat(convertOps)));
//         }

//         return E.left(makeParseError(node)(`parseExpressionAsBoolean ${type.getText()} failed`));
//     };
// }

// interface ChainContext {
//     readonly scope: Scope;
//     readonly endTarget: Operation;
//     readonly current?: CompileTimeObject;
//     readonly currentType?: tsm.Type;
//     readonly operations: ReadonlyArray<Operation>;
// }

// const reduceIdentifier = (node: tsm.Identifier) =>
//     (ctx: ChainContext): E.Either<ParseError, ChainContext> => {
//         return pipe(
//             node,
//             TS.parseSymbol,
//             E.chain($resolve(node)(ctx.scope)),
//             E.chain(current => {
//                 if (!current.loadOps)
//                     return E.left(makeParseError(node)(`${current.symbol.getName()} invalid load ops`));
//                 const operations = ROA.concat(current.loadOps)(ctx.operations);
//                 const context: ChainContext = { ...ctx, operations, current, currentType: undefined }
//                 return E.of(context);
//             })
//         );
//     }

// function resolveProperty(ctx: ChainContext) {
//     return (node: tsm.PropertyAccessExpression): E.Either<ParseError, CompileTimeObject> => {
//         return pipe(
//             node,
//             TS.parseSymbol,
//             E.bindTo('symbol'),
//             E.bind('typeDef', () => {

//                 const type = ctx.currentType ?? ctx.current?.node.getType();
//                 const symbol = type?.getSymbol();
//                 const resolved = symbol ? resolveType(ctx.scope)(symbol) : O.none;
//                 return pipe(
//                     ctx.currentType,
//                     O.fromNullable,
//                     O.alt(() => pipe(ctx.current?.node.getType(), O.fromNullable)),
//                     O.chain(TS.getTypeSymbol),
//                     O.chain(resolveType(ctx.scope)),
//                     O.toUndefined,
//                     E.of<ParseError, CompileTimeObject | undefined>
//                 );
//             }),
//             E.chain(({ symbol, typeDef }) => {
//                 return pipe(
//                     getProp(ctx.current, symbol),
//                     O.alt(() => getProp(typeDef, symbol)),
//                     E.fromOption(() => makeParseError(node)(`failed to resolve ${symbol.getName()} property`))
//                 )
//             })
//         );
//     };

//     function getProp(cto: CompileTimeObject | undefined, symbol: tsm.Symbol): O.Option<CompileTimeObject> {
//         return cto && cto.getProperty ? cto.getProperty(symbol) : O.none;
//     }
// }


// const reducePropertyAccessExpression =
//     (node: tsm.PropertyAccessExpression) =>
//         (ctx: ChainContext): E.Either<ParseError, ChainContext> => {
//             return pipe(
//                 node,
//                 resolveProperty(ctx),
//                 E.bindTo('property'),
//                 E.bind('loadOps', ({ property }) => {
//                     return pipe(
//                         property.loadOps
//                             ? E.of(property.loadOps)
//                             : E.left(makeParseError(node)(`failed to resolve ${property.symbol.getName()} load ops`)),
//                         E.map(ops => {
//                             return node.hasQuestionDotToken()
//                                 ? ROA.concat(ops)([
//                                     { kind: "duplicate" },
//                                     { kind: "isnull" },
//                                     { kind: "jumpif", target: ctx.endTarget }
//                                 ] as Operation[]) : ops;
//                         })
//                     );
//                 }),
//                 E.map(({ loadOps, property }) => {
//                     const operations = ROA.concat(loadOps)(ctx.operations);
//                     return {
//                         ...ctx,
//                         operations,
//                         current: property,
//                         currentType: node.getType(),
//                     } as ChainContext;
//                 })
//             )
//         }

// const reduceCallExpression =
//     (node: tsm.CallExpression) =>
//         (ctx: ChainContext): E.Either<ParseError, ChainContext> => {
//             const makeError = makeParseError(node);

//             return pipe(
//                 ctx.current,
//                 E.fromNullable(makeError('no current symbol')),
//                 E.chain(def => def.parseCall ? E.of(def.parseCall) : E.left(makeError('no parseCall'))),
//                 E.chain(func => func(ctx.scope)(node)),
//                 E.map(ops => ROA.concat(ctx.operations)(ops)),
//                 E.map(operations => {
//                     return {
//                         ...ctx,
//                         current: undefined,
//                         currentType: node.getType(),
//                         operations
//                     } as ChainContext
//                 })
//             )
//         }

// const reduceElementAccessExpression =
//     (node: tsm.ElementAccessExpression) =>
//         (ctx: ChainContext): E.Either<ParseError, ChainContext> => {
//             const makeError = makeParseError(node);

//             return pipe(
//                 node.getArgumentExpression(),
//                 E.fromNullable(makeError('no argument expression')),
//                 E.chain(parseExpression(ctx.scope)),
//                 E.map(ops => ROA.concat(ops)(ctx.operations)),
//                 E.map(ops => ROA.append({ kind: 'pickitem' })(ops)),
//                 E.map(operations => {
//                     return {
//                         ...ctx,
//                         current: undefined,
//                         currentType: node.getType(),
//                         operations
//                     } as ChainContext
//                 })
//             )
//         }

// // case SyntaxKind.AnyKeyword:
// // case SyntaxKind.ArrowFunction:
// // case SyntaxKind.AwaitExpression:
// // case SyntaxKind.ClassExpression:
// // case SyntaxKind.CommaListExpression:
// // case SyntaxKind.DeleteExpression:
// // case SyntaxKind.FunctionExpression:
// // case SyntaxKind.ImportKeyword:
// // case SyntaxKind.MetaProperty:
// // case SyntaxKind.NewExpression:
// // case SyntaxKind.NoSubstitutionTemplateLiteral:
// // case SyntaxKind.OmittedExpression:
// // case SyntaxKind.PartiallyEmittedExpression:
// // case SyntaxKind.PostfixUnaryExpression:
// // case SyntaxKind.RegularExpressionLiteral:
// // case SyntaxKind.SatisfiesExpression:
// // case SyntaxKind.SpreadElement:
// // case SyntaxKind.SuperKeyword:
// // case SyntaxKind.SymbolKeyword:
// // case SyntaxKind.TaggedTemplateExpression:
// // case SyntaxKind.TemplateExpression:
// // case SyntaxKind.ThisKeyword:
// // case SyntaxKind.TypeAssertionExpression:
// // case SyntaxKind.TypeOfExpression:
// // case SyntaxKind.VoidExpression:
// // case SyntaxKind.YieldExpression:


// const reduceChainContext = (node: tsm.Expression) =>
//     (ctx: ChainContext): E.Either<ParseError, ChainContext> => {
//         const type = node.getType();

//         switch (node.getKind()) {
//             case tsm.SyntaxKind.ArrayLiteralExpression:
//                 return reduceParseFunction(node as tsm.ArrayLiteralExpression, parseArrayLiteral(ctx.scope));
//             case tsm.SyntaxKind.AsExpression:
//                 return E.of({ ...ctx, currentType: node.getType() });
//             case tsm.SyntaxKind.BigIntLiteral:
//                 return reduceLiteral(node as tsm.BigIntLiteral, parseBigIntLiteral);
//             case tsm.SyntaxKind.BinaryExpression:
//                 return reduceParseFunction(node as tsm.BinaryExpression, parseBinaryExpression(ctx.scope));
//             case tsm.SyntaxKind.CallExpression:
//                 return reduceCallExpression(node as tsm.CallExpression)(ctx);
//             case tsm.SyntaxKind.ConditionalExpression:
//                 return reduceParseFunction(node as tsm.ConditionalExpression, parseConditionalExpression(ctx.scope));
//             case tsm.SyntaxKind.ElementAccessExpression:
//                 return reduceElementAccessExpression(node as tsm.ElementAccessExpression)(ctx);
//             case tsm.SyntaxKind.FalseKeyword:
//                 return reduceLiteral(node as tsm.FalseLiteral, parseBooleanLiteral);
//             case tsm.SyntaxKind.Identifier:
//                 return reduceIdentifier(node as tsm.Identifier)(ctx);
//             case tsm.SyntaxKind.NonNullExpression:
//                 return E.of(ctx);
//             case tsm.SyntaxKind.NullKeyword:
//                 return reduceLiteral(node, parseNullLiteral);
//             case tsm.SyntaxKind.NumericLiteral:
//                 return reduceLiteral(node as tsm.NumericLiteral, parseNumericLiteral);
//             case tsm.SyntaxKind.ObjectLiteralExpression:
//                 return reduceParseFunction(node as tsm.ObjectLiteralExpression, parseObjectLiteralExpression(ctx.scope));
//             case tsm.SyntaxKind.ParenthesizedExpression:
//                 return E.of(ctx);
//             case tsm.SyntaxKind.PrefixUnaryExpression:
//                 return reduceParseFunction(node as tsm.PrefixUnaryExpression, parsePrefixUnaryExpression(ctx.scope));
//             case tsm.SyntaxKind.PropertyAccessExpression:
//                 return reducePropertyAccessExpression(node as tsm.PropertyAccessExpression)(ctx);
//             case tsm.SyntaxKind.TrueKeyword:
//                 return reduceLiteral(node as tsm.TrueLiteral, parseBooleanLiteral);
//             case tsm.SyntaxKind.StringLiteral:
//                 return reduceLiteral(node as tsm.StringLiteral, parseStringLiteral);
//             case tsm.SyntaxKind.UndefinedKeyword:
//                 return reduceLiteral(node, parseNullLiteral);
//             default:
//                 return E.left(makeParseError(node)(`reduceChainContext ${(node as any).getKindName()}`));
//         }

//         function reduceLiteral<T extends tsm.Node>(node: T, func: (node: T) => E.Either<ParseError, Operation>) {
//             return reduceParseFunction(node, flow(func, E.map(ROA.of)));
//         }

//         function reduceParseFunction<T extends tsm.Node>(node: T, func: (node: T) => E.Either<ParseError, readonly Operation[]>) {
//             return pipe(
//                 node,
//                 func,
//                 E.map(ops => {
//                     return {
//                         ...ctx,
//                         current: undefined,
//                         currentType: node.getType(),
//                         operations: ROA.concat(ops)(ctx.operations)
//                     };
//                 })
//             );
//         }
//     }

// function reduceChain(scope: Scope) {
//     return (chain: readonly tsm.Expression[]) => {
//         const initialContext: ChainContext = {
//             endTarget: { kind: 'noop' },
//             operations: ROA.empty,
//             scope,
//         };
//         return pipe(
//             chain,
//             ROA.reduce(
//                 E.of<ParseError, ChainContext>(initialContext),
//                 (ctx, node) => pipe(ctx, E.chain(reduceChainContext(node)))
//             )
//         );

//     };
// }

// function makeExpressionChain(node: tsm.Expression): RNEA.ReadonlyNonEmptyArray<tsm.Expression> {
//     return makeChain(RNEA.of<tsm.Expression>(node));

//     function makeChain(
//         chain: RNEA.ReadonlyNonEmptyArray<tsm.Expression>
//     ): RNEA.ReadonlyNonEmptyArray<tsm.Expression> {
//         return pipe(
//             chain,
//             RNEA.head,
//             TS.getExpression,
//             O.match(
//                 () => chain,
//                 expr => makeChain(ROA.prepend(expr)(chain))
//             )
//         );
//     }
// }
