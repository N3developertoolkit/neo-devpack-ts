import * as tsm from "ts-morph";
import { $SymbolDef } from "../symbolDef";
import { Operation } from "../types/Operation";
import { Scope, CallableSymbolDef, ParseArgumentsFunc } from "../types/CompileTimeObject";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as E from "fp-ts/Either";
import * as TS from '../TS';
import { pipe } from "fp-ts/function";
import { parseArguments } from "./expressionProcessor";
import { ParseError } from "../utils";

function parseStore(loadOps: readonly Operation[], valueOps: readonly Operation[], storeOp: Operation) {
    return pipe(
        valueOps,
        ROA.concat(loadOps),
        ROA.append(storeOp),
        E.of
    );
}

export class LocalVariableSymbolDef extends $SymbolDef {

    get loadOps(): readonly Operation[] {
        return [{ kind: "loadlocal", index: this.index }];
    }

    get storeOp(): Operation {
        return { kind: "storelocal", index: this.index }
    }

    parseStore(loadOps: readonly Operation[], valueOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> {
        return parseStore(loadOps, valueOps, this.storeOp);
    }

    constructor(
        readonly decl: tsm.Identifier | tsm.BindingElement,
        symbol: tsm.Symbol,
        readonly index: number
    ) {
        super(decl, symbol);
        this.type = decl.getType();
    }

    type: tsm.Type<tsm.ts.Type>;
}

export class ParameterSymbolDef extends $SymbolDef {
    get loadOps() {
        return [{ kind: "loadarg", index: this.index }];
    }

    get storeOp(): Operation {
        return { kind: "storearg", index: this.index }
    }

    parseStore(loadOps: readonly Operation[], valueOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> {
        return parseStore(loadOps, valueOps, this.storeOp);
    }

    constructor(
        readonly decl: tsm.ParameterDeclaration,
        symbol: tsm.Symbol,
        readonly index: number
    ) {
        super(decl, symbol);
    }
}


export class StaticVarSymbolDef extends $SymbolDef {
    get loadOps(): readonly Operation[] {
        return [{ kind: "loadstatic", index: this.index }];
    }

    get storeOp(): Operation {
        return { kind: "storestatic", index: this.index }
    }

    parseStore(loadOps: readonly Operation[], valueOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> {
        return parseStore(loadOps, valueOps, this.storeOp);
    }

    constructor(
        readonly decl: tsm.Identifier | tsm.BindingElement | tsm.VariableDeclaration,
        symbol: tsm.Symbol,
        readonly index: number,
        readonly initOps?: readonly Operation[]
    ) {
        super(decl, symbol);
    }
}

export class ConstantSymbolDef extends $SymbolDef {
    readonly loadOps: readonly Operation[];

    constructor(
        readonly decl: tsm.Identifier | tsm.BindingElement | tsm.VariableDeclaration,
        symbol: tsm.Symbol,
        op: Operation
    ) {
        super(decl, symbol);
        this.loadOps = [op];
    }
}

export class EventFunctionSymbolDef extends $SymbolDef implements CallableSymbolDef {

    readonly loadOps: readonly Operation[];
    readonly props = [];

    constructor(
        readonly decl: tsm.FunctionDeclaration,
        symbol: tsm.Symbol,
        readonly eventName: string
    ) {
        super(decl, symbol);
        this.loadOps = ROA.of({ kind: 'syscall', name: "System.Runtime.Notify" })
    }

    parseCall = (scope: Scope) => (node: tsm.CallExpression): E.Either<ParseError, ReadonlyArray<Operation>> => {
        return pipe(
            node,
            parseArguments(scope),
            E.map(ROA.concat([
                { kind: "pushint", value: BigInt(node.getArguments().length) },
                { kind: 'packarray' },
                { kind: 'pushdata', value: Buffer.from(this.name, 'utf8') }
            ] as readonly Operation[]))
        );
    }

    static create(decl: tsm.FunctionDeclaration, tag: tsm.JSDocTag): E.Either<ParseError, EventFunctionSymbolDef> {
        return pipe(
            decl,
            TS.parseSymbol,
            E.map(symbol => {
                const eventName = tag.getCommentText() ?? symbol.getName();
                return new EventFunctionSymbolDef(decl, symbol, eventName);
            })
        );
    }
}

export class LocalFunctionSymbolDef extends $SymbolDef implements CallableSymbolDef {

    readonly loadOps: readonly Operation[];
    readonly props = [];
    readonly parseCall: ParseArgumentsFunc;

    constructor(readonly decl: tsm.FunctionDeclaration, symbol: tsm.Symbol) {
        super(decl, symbol);
        this.loadOps = [{ kind: 'call', method: this.symbol }]
        this.parseCall = parseArguments;
    }

    static create(decl: tsm.FunctionDeclaration): E.Either<ParseError, LocalFunctionSymbolDef> {
        return pipe(
            decl,
            TS.parseSymbol,
            E.map(symbol => new LocalFunctionSymbolDef(decl, symbol)),
        )
    }
}

// export class StructMemberSymbolDef extends $SymbolDef {
//     readonly loadOps: readonly Operation[];
//     readonly storeOps: readonly Operation[];

//     parseStore(loadOps: readonly Operation[], valueOps: readonly Operation[]): E.Either<ParseError, readonly Operation[]> {
//         return pipe(
//             valueOps, 
//             ROA.append({ kind: "duplicate" } as Operation),
//             ROA.concat(loadOps),
//             ROA.concat([
//                 { kind: "pushint", value: BigInt(this.index)},
//                 { kind: 'rotate' },
//                 { kind: "setitem" }
//             ] as Operation[]),
//             E.of)
//     }

//     constructor(
//         readonly sig: tsm.PropertySignature,
//         readonly index: number
//     ) {
//         super(sig);
//         this.loadOps = [
//             { kind: 'pushint', value: BigInt(index) },
//             { kind: 'pickitem' }
//         ];
//         this.storeOps = [
//             { kind: 'pushint', value: BigInt(index) },
//             // { kind: 'setitem' }
//         ];
        
//     }
// }

// export class StructSymbolDef extends $SymbolDef implements ObjectSymbolDef {
//     readonly loadOps = [];

//     constructor(
//         readonly decl: tsm.InterfaceDeclaration,
//         readonly props: readonly SymbolDef[]
//     ) {
//         super(decl);
//     }
// }


// export class TupleSymbolDef extends $SymbolDef implements ObjectSymbolDef {
//     readonly loadOps = [];

//     constructor(
//         readonly decl: tsm.TypeLiteralNode,
//         readonly props: readonly SymbolDef[]
//     ) {
//         super(decl);
//     }
// }