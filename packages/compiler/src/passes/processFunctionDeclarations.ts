import * as tsm from "ts-morph";
import { ParserState } from "../compiler";

import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RONEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import * as SG from "fp-ts/Semigroup";
import * as S from 'fp-ts/State';

type Diagnostic = tsm.ts.Diagnostic;
import { FunctionSymbolDef, getResultMonoid, makeParseError, SymbolDef, VariableSymbolDef } from "../symbolDef";
import { createReadonlyScope, ReadonlyScope } from "../scope";
import { JumpOperation, Operation } from "../types/Operation";

// export interface ContractMethod {
//     def: MethodSymbolDef,
//     operations: ReadonlyArray<Operation>,
//     variables: ReadonlyArray<{ name: string, type: tsm.Type }>,
// }

//     // const name = node.getNameOrThrow();
//         // name,
//         // safe: hasSafeTag(node),
//         // public: !!node.getExportKeyword(),
//         // returnType: node.getReturnType(),
//         // parameters: node.getParameters().map(p => ({ name: p.getName(), type: p.getType(), })),
//         // variables: builder.getVariables(),
//         // operations: builder.getOperations()

// export interface ProcessMethodOptions {
//     diagnostics: tsm.ts.Diagnostic[];
//     builder: MethodBuilder,
//     scope: ReadonlyScope,
// }

// // @internal
// export function processMethodDef(def: MethodSymbolDef, diagnostics: Array<tsm.ts.Diagnostic>): ContractMethod {

//     const node = def.node;
//     const body = node.getBodyOrThrow();
//     if (!tsm.Node.isStatement(body)) {
//         throw new CompileError(`Unexpected body kind ${body.getKindName()}`, body);
//     }

//     const builder = new MethodBuilder(node.getParameters().length);
//     processStatement(body, { diagnostics, builder, scope: def });

//     return {
//         def,
//         operations: builder.getOperations(),
//         variables: builder.getVariables(),
//     }
// }

// export function processMethodDefinitions(context: CompileContext) {

//     for (const scope of context.scopes) {
//         for (const def of scope.symbols) {
//             if (def instanceof MethodSymbolDef) {
//                 const method = processMethodDef(def, context.diagnostics);
//                 context.methods.push(method);
//             }
//         }
//     }
// }


// function parseFunctionDeclarations() {
//     // FunctionSymbolDef
// }

//     private readonly _operations = new Array<Operation>();
//     private readonly _returnTarget: TargetOffset = { operation: undefined };
//     private readonly _jumps = new Map<JumpOperation, TargetOffset>();
//     private readonly _locals = new Array<tsm.VariableDeclaration>();

export interface TargetOffset {
    operation: Operation | undefined
}


interface FunctionParserModel {
    readonly operations: ReadonlyArray<Operation>,
    readonly locals: ReadonlyArray<tsm.VariableDeclaration>;
    readonly jumpTargets: ReadonlyMap<JumpOperation, TargetOffset>;
    readonly returnTarget: TargetOffset,
    readonly diagnostics: ReadonlyArray<tsm.ts.Diagnostic>
}

export type FunctionParserState<T> = S.State<FunctionParserModel, T>;


export interface ContractMethod {
    symbol: tsm.Symbol,
    node: tsm.FunctionDeclaration,
    operations: ReadonlyArray<Operation>,
    variables: ReadonlyArray<{ name: string, type: tsm.Type }>,
}

export const parseFunctionDeclaration =
    (parentScope: ReadonlyScope) =>
        (def: FunctionSymbolDef): ParserState<ContractMethod> =>
            (diagnostics: ReadonlyArray<Diagnostic>) => {
                
                const contractMethod = {
                    node: def.node,
                    symbol: def.symbol,
                    operations: [],
                    variables: []
                };

                return [contractMethod, diagnostics]
            }
export const parseSourceFileDefs =
    (parentScope: ReadonlyScope) =>
        (defs: ReadonlyArray<SymbolDef>): ParserState<any> =>
            (diagnostics: ReadonlyArray<Diagnostic>) => {

                for (const def of defs) {
                    if (def instanceof FunctionSymbolDef && !def.$import) {

                        const pp = pipe(
                            def.node.getParameters(),
                            ROA.mapWithIndex((index, node) => pipe(
                                node.getSymbol(),
                                E.fromNullable(makeParseError(node)("undefined symbol")),
                                E.map(symbol => ROA.of(new VariableSymbolDef(symbol, 'arg', index))),
                            )),
                            M.concatAll(
                                getResultMonoid(
                                    ROA.getMonoid<VariableSymbolDef>())),
                            E.map(createReadonlyScope(parentScope))

                        )



                    }
                }


                return [42, diagnostics]
            }