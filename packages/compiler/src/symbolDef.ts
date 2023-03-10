import { CallOperation, CallTokenOperation, LoadStoreOperation, Operation, parseOperation, PushBoolOperation, PushDataOperation, PushIntOperation, SysCallOperation } from "./types/Operation";
import { createDiagnostic as $createDiagnostic, getArguments, isVoidLike } from "./utils";

import { sc, u } from '@cityofzion/neon-core';
import { ts, Node, VariableStatement, VariableDeclarationKind, SourceFile, Project, Symbol, VariableDeclaration, Expression, SyntaxKind, BigIntLiteral, NumericLiteral, StringLiteral, FunctionDeclaration, ImportDeclaration, ImportSpecifier, JSDocTag, InterfaceDeclaration, DiagnosticCategory, ParameterDeclaration, CallExpression, ExportedDeclarations, Type } from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RONEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from "fp-ts/Either";
import * as M from "fp-ts/Monoid";
import * as O from 'fp-ts/Option'
import * as SG from "fp-ts/Semigroup";
import * as S from 'fp-ts/State';
import { CompilerState } from "./compiler";
import { Scope } from "./scope";

type Diagnostic = ts.Diagnostic;

export interface ParseError { message: string, node?: Node }

export const makeParseError =
    (node?: Node) =>
        (e: string | unknown): ParseError => {
            const message = typeof e === 'string'
                ? e : e instanceof Error
                    ? e.message : String(e);
            return { message, node };
        }


export const makeParseDiagnostic = (e: ParseError) => $createDiagnostic(e.message, { node: e.node });

export interface SymbolDef {
    readonly symbol: Symbol;
    readonly type: Type;
    readonly loadOps?: ReadonlyArray<Operation>;
    readonly storeOps?: ReadonlyArray<Operation>;
}

export interface ObjectSymbolDef extends SymbolDef {
    readonly props: ReadonlyArray<SymbolDef>;
}

export function isObjectDef(def: SymbolDef): def is ObjectSymbolDef {
    return 'props' in def;
}

export const parseLoadOps =
    (node: Node) => (def: SymbolDef) => pipe(
        def.loadOps,
        E.fromNullable(makeParseError(node)(`${def.symbol.getName()} has no load ops`))
    );

export class $SymbolDef implements SymbolDef {
    readonly symbol: Symbol;
    readonly type: Type;

    get name() { return this.symbol.getName(); }
    get typeName() { return this.type.getSymbol()?.getName(); }

    protected constructor(
        private readonly node: Node,
        private _symbol?: Symbol
    ) {
        this.symbol = _symbol ?? node.getSymbolOrThrow();
        this.type = node.getType();
    }
}
