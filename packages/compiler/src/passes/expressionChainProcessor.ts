import { Expression, Identifier, Node } from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import * as TS from "../utility/TS";
import { Operation } from "../types/Operation";
import { resolve, Scope } from "../scope";
import { CallResult, GetPropResult, makeParseError, ParseError, parseSymbol } from "../symbolDef";

const makeExpressionChain =
    (node: Expression): RNEA.ReadonlyNonEmptyArray<Expression> => {

        return makeChain(RNEA.of<Expression>(node));

        function makeChain(
            chain: RNEA.ReadonlyNonEmptyArray<Expression>
        ): RNEA.ReadonlyNonEmptyArray<Expression> {
            const head = RNEA.head(chain);
            return Node.hasExpression(head)
                ? makeChain(ROA.prepend(head.getExpression())(chain))
                : chain;
        }
    }

interface ChainObject {
    //     readonly loadOperations?: ReadonlyArray<Operation>;
    //     parseGetProp?: (prop: tsm.Symbol) => O.Option<GetPropResult>;
    //     parseCall?: (node: tsm.CallExpression, scope: Scope) => E.Either<ParseError, CallResult>
}

export const parseIdentifier =
    (scope: Scope) =>
        (node: Identifier): E.Either<ParseError, ChainObject> => {
            return pipe(
                node,
                parseSymbol(),
                E.chain(symbol => pipe(
                    symbol,
                    resolve(scope),
                    E.fromOption(() => makeParseError(node)(`unresolved symbol ${symbol.getName()}`))
                )),
                // TODO: 
                E.map(s => ({} as ChainObject))
            );
        }

const resolveChainHead =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, ChainObject> => {
            if (Node.isIdentifier(node)) return parseIdentifier(scope)(node);
            return E.left(makeParseError(node)(`$resolveChainHead ${node.getKindName()} failed`))

        }

// export const parsePropertyAccessExpression =
//     (scope: Scope) =>
//     (obj: ChainObject) =>
//         (node: PropertyAccessExpression): E.Either<ParseError, ChainObject> => {
//         }

export const parseExpressionChain =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, ReadonlyArray<Operation>> => {

            const chain = makeExpressionChain(node);
            let obj = resolveChainHead(scope)(RNEA.head(chain));
            let tail = RNEA.tail(chain); 

            while (E.isRight(obj) && ROA.isNonEmpty(tail)) {
                node = RNEA.head(tail);
                tail = RNEA.tail(tail);

                if (Node.isPropertyAccessExpression(node)) {

                }

            }

            return E.left(makeParseError()(`parseExpressionChain failed`))
        }



        // export const parsePropertyAccessExpression =
//     (scope: Scope) =>
//         (node: tsm.PropertyAccessExpression): E.Either<ParseError, readonly Operation[]> => {

//             const c2 = makeExpressionChain(node);
//             parseCallChain(scope)(c2);

//             const expr = node.getExpression();
//             const type = expr.getType();
//             const propName = node.getName();

//             return pipe(
//                 expr,
//                 parseExpression(scope),
//                 E.bindTo('ops'),
//                 E.bind('index', () => pipe(
//                     type.getProperties(),
//                     ROA.findIndex(p => p.getName() === propName),
//                     E.fromOption(() => makeParseError(node)(`failed to resolve ${propName} property`))
//                 )),
//                 E.map(({ index, ops }) => pipe(
//                     ops,
//                     ROA.concat([
//                         { kind: 'pushint', value: BigInt(index) },
//                         { kind: 'pickitem' }
//                     ] as Operation[])
//                 ))
//             )
//         }



// export const parseCallExpression =
//     (scope: Scope) =>
//         (node: tsm.CallExpression): E.Either<ParseError, readonly Operation[]> => {


//             const c2 = makeExpressionChain(node);
//             parseCallChain(scope)(c2);

//             // Callable objects take scope + node and return the operations for the args + the call
//             // inside an Either. This enables certain callables to customize the argument parsing
//             // (example: Uint8Array.from can convert an array into a bytestring). They are returned
//             // as separate Operation arrays because any object navigation has to occur *between*
//             // the args and the call. For example, Storage.context.get(key) needs to push:
//             //      * the arguments
//             //      * the storage get context syscall
//             //      * the storage get syscall

//             const chain = resolveCallChain(node);
//             let access: ReadonlyArray<Operation> = ROA.empty;
//             let def = resolveIdentifier(scope)(chain.head);
//             let tail = chain.tail;
//             while (E.isRight(def) && ROA.isNonEmpty(tail)) {

//                 if (tsm.Node.isPropertyAccessExpression(next)) {
//                     def = pipe(
//                         next,
//                         parseSymbol(),
//                         E.bindTo('symbol'),
//                         E.bind('def', () => pipe(def, E.chain(asObject))),
//                         E.chain(getProp),
//                         E.map(prop => {
//                             access = ROA.concat(prop.access)(access);
//                             return prop.value
//                         })
//                     );
//                 } else {
//                     def = E.left(makeParseError(next)(`${next.getKindName()} not impl`));
//                 }
//             }

//             return pipe(
//                 def,
//                 E.chain(asCallable),
//                 E.chain(c => c.parseCall(node, scope)),
//                 E.map(c => M.concatAll(ROA.getMonoid<Operation>())([c.args, access, c.call]))
//             )
//         }


// const asObject = (def: SymbolDef) =>
//     pipe(
//         def,
//         E.fromPredicate(
//             isObjectDef,
//             d => makeParseError()(`${d.symbol.getName()} is not an object`)
//         )
//     );


// const asCallable = (def: SymbolDef) =>
//     pipe(
//         def,
//         E.fromPredicate(
//             isCallableDef,
//             d => makeParseError()(`${d.symbol.getName()} is not callable`)
//         )
//     );

// const getProp = ({ def, symbol }: {
//     readonly symbol: tsm.Symbol;
//     readonly def: ObjectSymbolDef;
// }) => pipe(
//     def.parseGetProp(symbol),
//     E.fromOption(() =>
//         makeParseError()(`invalid ${symbol.getName()} prop on ${def.symbol.getName()}`)
//     )
// )



// const parseCallChain =
//     (scope: Scope) =>
//         (chain: RNEA.ReadonlyNonEmptyArray<tsm.Expression>) => {

//             let def = $resolve(scope)(RNEA.head(chain))
//             let access: ReadonlyArray<Operation> = E.isRight(def)
//                 ? def.right.loadOperations ?? []
//                 : ROA.empty;

//             let tail = RNEA.tail(chain);

//             while (E.right(def) && ROA.isNonEmpty(tail)) {
//                 const head = RNEA.head(tail);
//                 tail = RNEA.tail(tail);
//                 if (tsm.Node.isPropertyAccessExpression(head)) {

//                 } else if (tsm.Node.isCallExpression(head)) {

//                 } else {
//                     return E.left(makeParseError(head)(`parseCallChain ${head.getKindName()} failed`))

//                 }

//             }
//         }