import * as tsm from "ts-morph";
import { resolveBuiltIn } from "./builtins";
import { CompileError } from "./compiler";
import { DefineSymbolFunction, Scope, SymbolDefinition } from "./types/CompileContext";
import { getSymbolOrCompileError } from "./utils";

class SymbolMap {
    private readonly map = new Map<tsm.Symbol, SymbolDefinition>();

    constructor(readonly scope: Scope) { }

    getSymbols() { return this.map.values(); }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>): T {
        const instance = typeof factory === 'function' ? factory(this.scope) : factory;
        if (instance.parentScope !== this.scope) {
            throw new Error(`Invalid scope for ${instance.symbol.getName()}`);
        }
        if (this.map.has(instance.symbol)) {
            throw new Error(`${instance.symbol.getName()} already defined in this scope`);
        }
        this.map.set(instance.symbol, instance);
        return instance;
    }

    resolve(symbol: tsm.Symbol): SymbolDefinition | undefined {
        const neoSymbol = this.map.get(symbol);
        return neoSymbol ?? this.scope.parentScope?.resolve(symbol);
    }
}

abstract class ScopeImpl implements Scope {
    private readonly map: SymbolMap;

    constructor(readonly name: string, readonly parentScope: Scope) {
        this.map = new SymbolMap(this);
    }

    getSymbols() {
        return this.map.getSymbols();
    }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>) {
        return this.map.define(factory);
    }

    resolve(symbol: tsm.Symbol): SymbolDefinition | undefined {
        return this.map.resolve(symbol);
    }
}

abstract class ScopedSymbolDefinition extends ScopeImpl implements SymbolDefinition {

    constructor(
        readonly node: tsm.Node,
        readonly parentScope: Scope
    ) {
        const symbol = getSymbolOrCompileError(node);
        super(`${symbol.getName()} function`, parentScope);
        this.symbol = symbol;
    }

    readonly symbol: tsm.Symbol;
}

export class BlockScope extends ScopeImpl {
    constructor(
        readonly node: tsm.Block,
        scope: Scope
    ) {
        super("<block>", scope);
    }
}

export class FunctionSymbolDefinition extends ScopedSymbolDefinition {
    constructor(
        readonly node: tsm.FunctionDeclaration,
        scope: Scope
    ) {
        super(node, scope);

        const params = node.getParameters();
        const paramsLength = params.length;
        for (let i = 0; i < paramsLength; i++) {
            this.define(s => new ParameterSymbolDefinition(params[i], s, i));
        }
    }
}

export class VariableSymbolDefinition implements SymbolDefinition {
    readonly symbol: tsm.Symbol;
    constructor(
        readonly node: tsm.VariableDeclaration,
        readonly parentScope: Scope
    ) {
        this.symbol = getSymbolOrCompileError(node);
    }

    get declarationKind() { return this.node.getVariableStatementOrThrow().getDeclarationKind();}
    get initializer() { return this.node.getInitializer(); }
}

export class ParameterSymbolDefinition implements SymbolDefinition {
    readonly symbol: tsm.Symbol;
    readonly index: number;
    constructor(
        readonly node: tsm.ParameterDeclaration,
        readonly parentScope: Scope,
        index?: number,
    ) {
        this.symbol = getSymbolOrCompileError(node);
        if (index) {
            this.index = index;
        } else {
            const parent = node.getParent();
            if (!tsm.Node.isParametered(parent)) { throw new CompileError(`Invalid ParameterDeclaration Parent`, parent); }
            this.index = parent.getParameters().findIndex(v => v === node);
            if (this.index < 0) { throw new CompileError(`Could not find ParameterDeclaration`, parent); }
        }
    }
}

class GlobalScope implements Scope {
    private readonly map: SymbolMap;

    constructor() {
        this.map = new SymbolMap(this);
    }

    readonly name = "<global>";
    readonly parentScope = undefined;

    getSymbols() { return this.map.getSymbols(); }

    define<T extends SymbolDefinition>(factory: T | DefineSymbolFunction<T>) {
        return this.map.define(factory);
    }

    resolve(symbol: tsm.Symbol): SymbolDefinition | undefined {
        const resolved = this.map.resolve(symbol);
        return resolved ?? resolveBuiltIn(symbol, this);
    }
}

// type InitializerType = boolean |  bigint | ReadonlyUint8Array;

// function parseInitializer(node: tsm.Expression, scope: Scope): InitializerType | undefined {

//     return dispatch<Scope, InitializerType | undefined>(node, scope, {
//         [tsm.SyntaxKind.ArrayLiteralExpression]: (node) => {
//             const bytes = new Array<number>();
//             for (const element of node.getElements()) {
//                 if (tsm.Node.isNumericLiteral(element)) {
//                     const value = element.getLiteralValue();
//                     if (Number.isInteger(value) && value >= 0 && value <= 255) {
//                         bytes.push(value);
//                     } else {
//                         return undefined;
//                     }
//                 } else {
//                     return undefined;
//                 }
//             }
//             return Uint8Array.from(bytes);
//         },
//         [tsm.SyntaxKind.AsExpression]: (node) => {
//             const typeNode = node.getTypeNodeOrThrow();
//             const asConst = typeNode.asKind(tsm.SyntaxKind.TypeReference)
//                 ?.getTypeName().asKind(tsm.SyntaxKind.Identifier)
//                 ?.compilerNode.originalKeywordKind === tsm.SyntaxKind.ConstKeyword;
//             return asConst ? parseInitializer(node.getExpression(), scope) : undefined;
//         },
//         [tsm.SyntaxKind.BigIntLiteral]: (node) => {
//             return node.getLiteralValue() as bigint;
//         },
//         [tsm.SyntaxKind.FalseKeyword]: (node) => {
//             return node.getLiteralValue();
//         },
//         [tsm.SyntaxKind.NumericLiteral]: (node) => {
//             const literal = node.getLiteralValue();
//             if (!Number.isInteger(literal)) throw new CompileError(`invalid non-integer numeric literal`, node);
//             return BigInt(literal);
//         },
//         [tsm.SyntaxKind.StringLiteral]: (node) => {
//             return Buffer.from(node.getLiteralValue(), 'utf-8');
//         },
//         [tsm.SyntaxKind.TrueKeyword]: (node) => {
//             return node.getLiteralValue();
//         },
//     });
// }

// function createVariableSymbol(node: tsm.VariableDeclaration, scope: Scope) {
//     const kind = node.getVariableStatement()?.getDeclarationKind();
//     const value = parseInitializer(node.getInitializerOrThrow(), scope);


//     const symbol = node.getSymbolOrThrow();

//     if (kind === tsm.VariableDeclarationKind.Const) {

//     }

//     //     const symbol = 
//     //     const init = node.getInitializerOrThrow();
//     //     dispatch(init, { scope, symbol }, {
//     //         [tsm.SyntaxKind.AsExpression]: (node, options) => {
//     //             const typeNode = node.getTypeNodeOrThrow();
//     //             const asConst = typeNode.asKind(tsm.SyntaxKind.TypeReference)
//     //                 ?.getTypeName().asKind(tsm.SyntaxKind.Identifier)
//     //                 ?.compilerNode.originalKeywordKind === tsm.SyntaxKind.ConstKeyword;
//     //             if (asConst) {
//     //                 createVariableSymbol(node.getExpression(), )
//     //             }

//     //         },
//     //         [tsm.SyntaxKind.ArrayLiteralExpression]: (node, options) => {
//     //             const literal = parseArrayLiteral(node);
//     //             if (!literal) throw new CompileError("Invalid constant array literal", node);
//     //             options.scope.define(s => new ConstantValueSymbolDefinition(options.symbol, s, literal));
//     //         },
//     //         [tsm.SyntaxKind.BigIntLiteral]: (node, options) => {
//     //             if (kind !== tsm.VariableDeclarationKind.Const) { throw new CompileError(`createVariableSymbol ${kind} ${node.getKindName()} not implemented`, node); }
//     //             const literal = node.getLiteralValue() as bigint;
//     //             options.scope.define(s => new ConstantValueSymbolDefinition(options.symbol, s, literal))
//     //         },
//     //         [tsm.SyntaxKind.FalseKeyword]: (node, options) => {
//     //             if (kind !== tsm.VariableDeclarationKind.Const) { throw new CompileError(`createVariableSymbol ${kind} ${node.getKindName()} not implemented`, node); }
//     //             const literal = node.getLiteralValue();
//     //             options.scope.define(s => new ConstantValueSymbolDefinition(options.symbol, s, literal))
//     //         },
//     //         [tsm.SyntaxKind.NumericLiteral]: (node, options) => {
//     //             if (kind !== tsm.VariableDeclarationKind.Const) { throw new CompileError(`createVariableSymbol ${kind} ${node.getKindName()} not implemented`, node); }
//     //             const literal = node.getLiteralValue();
//     //             if (!Number.isInteger(literal)) throw new CompileError(`invalid non-integer numeric literal`, node);
//     //             options.scope.define(s => new ConstantValueSymbolDefinition(options.symbol, s, literal));
//     //         },
//     //         [tsm.SyntaxKind.StringLiteral]: (node, options) => {
//     //             if (kind !== tsm.VariableDeclarationKind.Const) { throw new CompileError(`createVariableSymbol ${kind} ${node.getKindName()} not implemented`, node); }
//     //             const data = Buffer.from(node.getLiteralValue(), 'utf-8');
//     //             options.scope.define(s => new ConstantValueSymbolDefinition(options.symbol, s, data))
//     //         },
//     //         [tsm.SyntaxKind.TrueKeyword]: (node, options) => {
//     //             if (kind !== tsm.VariableDeclarationKind.Const) { throw new CompileError(`createVariableSymbol ${kind} ${node.getKindName()} not implemented`, node); }
//     //             const literal = node.getLiteralValue();
//     //             options.scope.define(s => new ConstantValueSymbolDefinition(options.symbol, s, literal))
//     //         },
//     //     })
// }

export function createSymbolTable(project: tsm.Project): Scope {
    const globals = new GlobalScope();

    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;

        src.forEachChild(node => {

            if (tsm.Node.isFunctionDeclaration(node)) {
                globals.define(s => new FunctionSymbolDefinition(node, s));
            }
            else if (tsm.Node.isVariableStatement(node)) {
                for (const decl of node.getDeclarations()) {
                    globals.define(s => new VariableSymbolDefinition(decl, s));
                }
            }
        });
    }

    return globals;
}