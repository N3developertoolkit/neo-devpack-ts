import { Node, Symbol, FunctionDeclaration, JSDocTag, VariableStatement, Expression, SyntaxKind, BigIntLiteral, NumericLiteral, StringLiteral, VariableDeclarationKind, SourceFile, ts, VariableDeclaration, CallExpression } from "ts-morph";
import { createScope, Scope, updateScope } from "../scope";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import * as TS from '../utility/TS';
import * as E from "fp-ts/Either";
import * as O from 'fp-ts/Option'

import { createDiagnostic, single } from "../utils";
import { identity, pipe } from "fp-ts/function";
import { ContractMethod } from "../compiler";
import { $SymbolDef, CallableSymbolDef, makeParseDiagnostic, makeParseError, ParseArgumentsFunc, ParseError, SymbolDef } from "../symbolDef";
import { parseContractMethod } from "./processFunctionDeclarations";
import { Operation } from "../types";
import { parseArguments, parseExpression } from './expressionProcessor';

export const parseSymbol = (node: Node): E.Either<ParseError, Symbol> => {
    return pipe(
        node,
        TS.getSymbol,
        E.fromOption(() => makeParseError(node)('invalid symbol'))
    );
}


type ConstantValue = bigint | boolean | Uint8Array | null;

class ConstantSymbolDef2 extends $SymbolDef {
    readonly loadOps: readonly Operation[];

    constructor(
        readonly decl: VariableDeclaration,
        symbol: Symbol,
        op: Operation
    ) {
        super(decl, symbol);
        this.loadOps = [op];
    }
}

class ConstantSymbolDef extends $SymbolDef {
    readonly loadOps: readonly Operation[];

    constructor(
        readonly decl: VariableDeclaration,
        symbol: Symbol,
        readonly value: ConstantValue
    ) {
        super(decl, symbol);
        this.loadOps = [ConstantSymbolDef.getLoadOp(value)];
    }

    private static getLoadOp(value: ConstantValue): Operation {
        if (value === null)
            return { kind: 'pushnull' };
        if (value instanceof Uint8Array)
            return { kind: 'pushdata', value };
        if (typeof value === 'bigint')
            return { kind: 'pushint', value };
        if (typeof value === 'boolean')
            return { kind: 'pushbool', value };
        throw new Error(`Invalid ConstantValue ${value}`);
    }
}

class EventSymbolDef extends $SymbolDef implements CallableSymbolDef {

    readonly loadOps: readonly Operation[];
    readonly props = [];

    constructor(
        readonly decl: FunctionDeclaration,
        symbol: Symbol,
        readonly eventName: string
    ) {
        super(decl, symbol);
        this.loadOps = ROA.of({ kind: 'syscall', name: "System.Runtime.Notify" })
    }

    parseArguments = (scope: Scope) => (node: CallExpression): E.Either<ParseError, ReadonlyArray<Operation>> => {
        return pipe(
            node,
            parseArguments(scope),
            E.map(ROA.concat([
                { kind: "pushint", value: BigInt(node.getArguments().length) },
                { kind: 'pack' },
                { kind: 'pushdata', value: Buffer.from(this.name, 'utf8') }
            ] as readonly Operation[]))
        );
    }

    static create(decl: FunctionDeclaration, tag: JSDocTag): E.Either<ParseError, EventSymbolDef> {
        return pipe(
            decl,
            parseSymbol,
            E.map(symbol => {
                const eventName = tag.getCommentText() ?? symbol.getName();
                return new EventSymbolDef(decl, symbol, eventName);
            })
        );
    }
}

class FunctionSymbolDef extends $SymbolDef implements CallableSymbolDef {

    readonly loadOps: readonly Operation[];
    readonly props = [];
    readonly parseArguments: ParseArgumentsFunc;

    constructor(readonly decl: FunctionDeclaration, symbol: Symbol) {
        super(decl, symbol);
        this.loadOps = [{ kind: 'call', method: this.symbol }]
        this.parseArguments = parseArguments;
    }

    static create(decl: FunctionDeclaration): E.Either<ParseError, FunctionSymbolDef> {
        return pipe(
            decl,
            parseSymbol,
            E.map(symbol => new FunctionSymbolDef(decl, symbol)),
        )
    }
}

function isFunctionSymbolDef(def: SymbolDef): def is FunctionSymbolDef {
    return def instanceof FunctionSymbolDef;
}

const parseSrcFunctionDeclaration = (node: FunctionDeclaration): E.Either<ParseError, SymbolDef> => {
    if (node.hasDeclareKeyword()) {
        return pipe(
            node,
            TS.getTag("event"),
            E.fromOption(() => makeParseError(node)('only @event declare functions supported')),
            E.chain(tag => EventSymbolDef.create(node, tag)),
        )
    } else {
        return FunctionSymbolDef.create(node);
    }
}

const parseSrcLetVariableStatement = (node: VariableStatement): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> => {
    if (node.getDeclarationKind() === VariableDeclarationKind.Const)
        return E.left(ROA.of(makeParseError(node)('const variable statement passed to parseSrcLetVariableStatement')))

    return E.left(ROA.of(makeParseError(node)(`parseSrcVariableStatement not implemented`)));
}

function isPushOp(op: Operation) {
    return op.kind === "pushbool"
        || op.kind === "pushdata"
        || op.kind === "pushint"
        || op.kind === "pushnull";
}


const parseConstantValue2 =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, Operation> => {
            return pipe(
                node,
                parseExpression(scope),
                O.fromEither,
                O.chain(single),
                O.chain(O.fromPredicate(isPushOp)),
                E.fromOption(() => makeParseError(node)('invalid const'))
            );
        }

const parseConstantValue =
    (scope: Scope) =>
        (node: Expression): E.Either<ParseError, ConstantValue> => {


            switch (node.getKind()) {
                case SyntaxKind.NullKeyword:
                    return E.of(null);
                case SyntaxKind.FalseKeyword:
                    return E.of(false);
                case SyntaxKind.TrueKeyword:
                    return E.of(true);
                case SyntaxKind.BigIntLiteral: {
                    const literal = (node as BigIntLiteral).getLiteralValue() as bigint;
                    return E.of(literal);
                }
                case SyntaxKind.NumericLiteral: {
                    const literal = (node as NumericLiteral).getLiteralValue();
                    return Number.isInteger(literal)
                        ? E.of(BigInt(literal))
                        : E.left(makeParseError(node)(`invalid non-integer numeric literal ${literal}`));
                }
                case SyntaxKind.StringLiteral: {
                    const literal = (node as StringLiteral).getLiteralValue();
                    return E.of(Buffer.from(literal, 'utf8'));
                }
                // case tsm.SyntaxKind.ArrayLiteralExpression: 
                // case tsm.SyntaxKind.ObjectLiteralExpression:
                default:
                    return E.left(makeParseError(node)(`Unsupported const type ${node.getKindName()}`));
            }
        }

const parseConstVariableStatement =
    (scope: Scope) =>
        (node: VariableStatement): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> => {

            if (node.getDeclarationKind() !== VariableDeclarationKind.Const)
                return E.left(ROA.of(makeParseError(node)('non const variable statement passed to parseConstVariableStatement')))

            const { left: failures, right: sources } = pipe(
                node.getDeclarations(),
                ROA.map(decl => {
                    return pipe(
                        decl.getInitializer(),
                        E.fromNullable(makeParseError(decl)('missing initializer')),
                        E.chain(parseConstantValue2(scope)),
                        E.bindTo('value'),
                        E.bind('symbol', () => parseSymbol(decl)),
                        E.map(({ value, symbol }) => new ConstantSymbolDef2(decl, symbol, value))
                    )
                }),
                ROA.partitionMap(identity),
            )

            return failures.length > 0 ? E.left(failures) : E.right(sources);
        }

// const parseSrcDeclaration = (node: Node): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> => {
//     if (Node.isFunctionDeclaration(node)) {
//         return pipe(
//             node,
//             parseSrcFunctionDeclaration,
//             E.map(ROA.of),
//             E.mapLeft(ROA.of)
//         );
//     }
//     if (Node.isVariableStatement(node)) {
//         if (node.getDeclarationKind() === VariableDeclarationKind.Const) {
//             return parseConstVariableStatement(node);
//         } else {
//             return parseSrcLetVariableStatement(node);
//         }
//     }
//     if (node.getKind() == SyntaxKind.EndOfFileToken) return E.of(ROA.empty);
//     return E.left(ROA.of(makeParseError(node)(`parseSourceFileSymbols ${node.getKindName()}`)));
// }

// const parseSrcDeclarations = (src: SourceFile): E.Either<ReadonlyArray<ParseError>, ReadonlyArray<SymbolDef>> => {

//     if (src.isDeclarationFile()) { return E.of([]) }

//     let defs: ReadonlyArray<SymbolDef> = ROA.empty;
//     for (const child of pipe(src, TS.getChildren)) {
//         const result = parseSrcDeclaration(child);
//         if (E.isLeft(result)) return result;
//         defs = ROA.concat(result.right)(defs);
//     }
//     return E.of(defs);
// }

export const parseSourceFile =
    (src: SourceFile, parentScope: Scope): S.State<ReadonlyArray<ts.Diagnostic>, ReadonlyArray<ContractMethod>> =>
        diagnostics => {
            if (src.isDeclarationFile()) {
                const diag = createDiagnostic(`${src.getFilePath()} is a declaration file`, {
                    node: src,
                    category: ts.DiagnosticCategory.Warning
                });
                return [[], ROA.append(diag)(diagnostics)]
            }

            const children = pipe(src, TS.getChildren);
            const { left: errors, right: functionDefs } = pipe(
                children,
                ROA.filterMap(O.fromPredicate(Node.isFunctionDeclaration)),
                ROA.map(parseSrcFunctionDeclaration),
                ROA.map(E.mapLeft(makeParseDiagnostic)),
                ROA.partitionMap(identity)
            );

            if (errors.length > 0) {
                return [[], ROA.concat(errors)(diagnostics)]
            }

            let scope = createScope(parentScope)(functionDefs);
            let methods: ReadonlyArray<ContractMethod> = ROA.empty;

            for (const node of children) {
                if (Node.isFunctionDeclaration(node)) {
                    const result = pipe(
                        node,
                        parseContractMethod(scope),
                        E.mapLeft(ROA.map(makeParseDiagnostic)),
                    );
                    if (E.isLeft(result)) {
                        diagnostics = ROA.concat(result.left)(diagnostics);
                    } else {
                        methods = ROA.append(result.right)(methods);
                    }
                } else if (Node.isVariableStatement(node)) {
                    if (node.getDeclarationKind() === VariableDeclarationKind.Const) {
                        const results = pipe(
                            node,
                            parseConstVariableStatement(scope),
                            E.mapLeft(ROA.map(makeParseDiagnostic))
                        );
                        if (E.isLeft(results)) {
                            diagnostics = ROA.concat(results.left)(diagnostics);
                        } else {
                            scope = updateScope(scope)(results.right);
                        }
                        } else {
                        const diag = createDiagnostic(`static variables not impl`, { node });
                        diagnostics = ROA.append(diag)(diagnostics);
                    }
                } else if (node.getKind() == SyntaxKind.EndOfFileToken) {
                    // ignore EOF
                } else {
                    const diag = createDiagnostic(`parseSourceFile ${node.getKindName()}`, { node });
                    diagnostics = ROA.append(diag)(diagnostics);
                }

            }
            return [[], diagnostics];



            // for (const node of children) {
            //     if (Node.isFunctionDeclaration(node)) {
            //         pipe(
            //             node,
            //             parseContractMethod(scope),
            //             E.mapLeft(ROA.map(makeParseDiagnostic)),
            //             E.match(
            //                 diags => {
            //                     // diagnostics = ROA.concat(diags)(diagnostics);
            //                 },
            //                 method => {
            //                     methods = ROA.append(method)(methods);
            //                 }
            //             )
            //         );
            //     } else if (Node.isVariableStatement(node)) {
            //         if (node.getDeclarationKind() === VariableDeclarationKind.Const) {
            //             return parseConstVariableStatement(node);
            //         } else {
            //             return parseSrcLetVariableStatement(node);
            //         }
            //     } else if (node.getKind() == SyntaxKind.EndOfFileToken) {
            //         // ignore EOF
            //     } else {
            //         // diagnostics = ROA.append(diag)(diagnostics);
            //     }
            // }

            // return [[], diagnostics];


            // // const srcDeclsE = pipe(
            // //     src,
            // //     parseSrcDeclarations,
            // //     E.mapLeft(ROA.map(makeParseDiagnostic)),
            // // );
            // // if (E.isLeft(srcDeclsE)) {
            // //     return [[], ROA.concat(srcDeclsE.left)(diagnostics)];
            // // }

            // // const scope = createScope(parentScope)(srcDeclsE.right);

            // // 
            // // pipe(
            // //     srcDeclsE.right,
            // //     ROA.filterMap(O.fromPredicate(isFunctionSymbolDef)),
            // //     ROA.map(f => parseContractMethod(scope)(f.decl)),
            // //     ROA.map(
            // //         E.match(
            // //             errors => {
            // //                 diagnostics = pipe(
            // //                     errors,
            // //                     ROA.map(makeParseDiagnostic),
            // //                     ROA.concat(diagnostics)
            // //                 )
            // //             },
            // //             method => {
            // //                 methods = ROA.append(method)(methods);
            // //             }
            // //         )
            // //     )
            // // )
            // // return [methods, diagnostics]

        }
