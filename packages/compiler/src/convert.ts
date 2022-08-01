import * as tsm from "ts-morph";
import { builtins } from "./builtins";
import { CompileError } from "./compiler";
import { CompileContext, OperationInfo } from "./types/CompileContext";
import { JumpTarget, NeoService, neoServices } from "./types/Instruction";
import { OpCode } from "./types/OpCode";
import { OperationBuilder, SlotType } from "./types/OperationBuilder";
import { Immutable } from "./utility/Immutable";
import { isBigIntLike, isStringLike } from "./utils";

export interface ConverterOptions {
    context: Immutable<CompileContext>,
    info: Immutable<OperationInfo>,
    builder: OperationBuilder,
    returnTarget: JumpTarget,
};

type ConvertFunction<TNode extends tsm.Node> = (node: TNode, options: ConverterOptions) => void;

type NodeConvertMap = {
    [TKind in tsm.SyntaxKind]?: ConvertFunction<tsm.KindToNodeMappings[TKind]>
};

function resolveInteropCall(signature: tsm.MethodSignature | tsm.PropertySignature, options: ConverterOptions): ConvertFunction<tsm.Node> | undefined {
    const calls = new Array<(builder: OperationBuilder) => void>();

    for (const doc of signature.getJsDocs()) {
        for (const tag of doc.getTags()) {
            if (tag.getTagName() === 'syscall') {
                const syscall = tag.getCommentText();
                if (!syscall) continue;
                const i = neoServices.indexOf(syscall as NeoService);
                if (i < 0) throw new Error();
                calls.push((builder) => { builder.pushSysCall(syscall as NeoService); })
            }
        }
    }

    return calls.length === 0 ? undefined
        : (node, options) => {
            const { builder } = options;

            if (tsm.Node.isCallExpression(node)) {
                if (!signature.isKind(tsm.SyntaxKind.MethodSignature)) {
                    throw new CompileError("expected method", node);
                }

                const args = node.getArguments();
                const argsLength = args.length;
                for (let i = argsLength - 1; i >= 0; i--) {
                    const arg = args[i];
                    if (tsm.Node.isExpression(arg)) {
                        convertExpression(arg, options);
                    } else {
                        throw new CompileError(`Expected expression, got ${arg.getKindName()}`, arg);
                    }
                }
            } else if (tsm.Node.isPropertyAccessExpression(node)) {
                if (!signature.isKind(tsm.SyntaxKind.PropertySignature)) {
                    throw new CompileError("expected property", node);
                }
            } else {
                throw new Error(`Invalid SysCall node ${node.getKindName()}`);
            }

            for (const call of calls) { call(builder); }
        }
}


function resolveSymbolDeclaration(decl: tsm.Node, name: string, options: ConverterOptions): ConvertFunction<tsm.Node> | undefined {

    if (!decl.getSourceFile().isDeclarationFile()) { return undefined; }

    if (tsm.Node.isMethodSignature(decl) || tsm.Node.isPropertySignature(decl)) {
        const interopCall = resolveInteropCall(decl, options);
        if (interopCall) { return interopCall; }
    }

    const ancestors = decl.getAncestors()
        .filter(n => !n.isKind(tsm.SyntaxKind.SourceFile))
        .map(a => a.getSymbol()?.getName() ?? "<undefined>");

    if (ancestors.length == 1) {
        const parent = builtins[ancestors[0]];
        if (parent) {
            const func = parent[name];
            if (func) { return func; }
        }
    }

    ancestors.reverse();
    ancestors.push(name);
    return (node, options) => {
        throw new CompileError(`${ancestors.join('.')} not defined`, node);
    };
}

function resolveSymbol(symbol: tsm.Symbol | undefined, options: ConverterOptions): ConvertFunction<tsm.Node> | undefined {
    if (!symbol) { return undefined; }
    const decl = symbol.getValueDeclaration();
    if (!decl) { return undefined; }

    const declFunc = resolveSymbolDeclaration(decl, symbol.getName(), options);
    if (declFunc) { return declFunc; }

    if (tsm.Node.isParameterDeclaration(decl)) {
        const parent = decl.getParent();
        if (tsm.Node.isFunctionLikeDeclaration(parent)) {
            const index = parent.getParameters()
                .findIndex(p => p.getSymbol() === symbol);
            if (index >= 0) {
                return (_node, options) => {
                    const { builder } = options;
                    builder.pushLoad(SlotType.Parameter, index);
                }
            }
        }
    }

    return undefined;
}

export function convertStatement(node: tsm.Statement, options: ConverterOptions): void {

    return dispatch(node.getKind(), {
        [tsm.SyntaxKind.Block]: convertBlock,
        [tsm.SyntaxKind.ExpressionStatement]: convertExpressionStatement,
        [tsm.SyntaxKind.IfStatement]: convertIfStatement,
        [tsm.SyntaxKind.ReturnStatement]: convertReturnStatement,
        [tsm.SyntaxKind.ThrowStatement]: convertThrowStatement,
    })

    function dispatch<TKind extends tsm.SyntaxKind>(kind: TKind, convertMap: NodeConvertMap) {
        const converter = convertMap[kind];
        if (converter) {
            converter(node.asKindOrThrow(kind), options);
        } else {
            throw new CompileError(`${tsm.SyntaxKind[kind]} not supported`, node)
        }
    }
}

// case SyntaxKind.Block:
function convertBlock(node: tsm.Block, options: ConverterOptions) {
    const { builder } = options;
    builder.push(OpCode.NOP)
        .set(node.getFirstChildByKind(tsm.SyntaxKind.OpenBraceToken));
    node.getStatements()
        .forEach(s => convertStatement(s, options));
    builder.push(OpCode.NOP)
        .set(node.getLastChildByKind(tsm.SyntaxKind.CloseBraceToken));
}

// case SyntaxKind.BreakStatement:
// case SyntaxKind.ClassDeclaration:
// case SyntaxKind.ContinueStatement:
// case SyntaxKind.DebuggerStatement:
// case SyntaxKind.DoStatement:
// case SyntaxKind.EmptyStatement:
// case SyntaxKind.EnumDeclaration:
// case SyntaxKind.ExportAssignment:
// case SyntaxKind.ExportDeclaration:
// case SyntaxKind.ExpressionStatement:
function convertExpressionStatement(node: tsm.ExpressionStatement, options: ConverterOptions) {
    const { builder } = options;
    const spSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    convertExpression(expr, options);
    spSetter.set(node);
}

// case SyntaxKind.ForInStatement:
// case SyntaxKind.ForOfStatement:
// case SyntaxKind.ForStatement:
// case SyntaxKind.FunctionDeclaration:
// case SyntaxKind.IfStatement:
function convertIfStatement(node: tsm.IfStatement, options: ConverterOptions) {
    const { builder } = options;
    const elseTarget: JumpTarget = { instruction: undefined };
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    convertExpression(expr, options);
    nodeSetter.set(expr);
    builder.pushJump(OpCode.JMPIFNOT_L, elseTarget);
    convertStatement(node.getThenStatement(), options);
    const _else = node.getElseStatement();
    if (_else) {
        const endTarget: JumpTarget = { instruction: undefined };
        builder.pushJump(endTarget);
        elseTarget.instruction = builder.push(OpCode.NOP).instruction;
        convertStatement(_else, options);
        endTarget.instruction = builder.push(OpCode.NOP).instruction;
    } else {
        elseTarget.instruction = builder.push(OpCode.NOP).instruction;
    }
}

// case SyntaxKind.ImportDeclaration:
// case SyntaxKind.ImportEqualsDeclaration:
// case SyntaxKind.InterfaceDeclaration:
// case SyntaxKind.LabeledStatement:
// case SyntaxKind.ModuleBlock:
// case SyntaxKind.ModuleDeclaration:
// case SyntaxKind.NotEmittedStatement:
// case SyntaxKind.ReturnStatement:
function convertReturnStatement(node: tsm.ReturnStatement, options: ConverterOptions) {
    const { builder, returnTarget } = options;
    const nodeSetter = builder.getNodeSetter();
    const expr = node.getExpression();
    if (expr) { convertExpression(expr, options); }
    builder.pushJump(returnTarget);
    nodeSetter.set(node);
}

// case SyntaxKind.SwitchStatement:
// case SyntaxKind.ThrowStatement:
function convertThrowStatement(node: tsm.ThrowStatement, options: ConverterOptions) {
    const { builder } = options;
    const nodeSetter = builder.getNodeSetter();

    var expr = node.getExpression();
    if (tsm.Node.isNewExpression(expr)) {

    }

    builder.pushData("some shit happened");
    builder.push(OpCode.THROW);
    nodeSetter.set(node);
}

// case SyntaxKind.TryStatement:
// case SyntaxKind.TypeAliasDeclaration:
// case SyntaxKind.VariableStatement:
// case SyntaxKind.WhileStatement:
// case SyntaxKind.WithStatement:

export function convertExpression(node: tsm.Expression, options: ConverterOptions) {

    return dispatch(node.getKind(), {
        // [tsm.SyntaxKind.ArrayLiteralExpression]: convertArrayLiteralExpression,
        [tsm.SyntaxKind.BigIntLiteral]: convertBigIntLiteral,
        [tsm.SyntaxKind.BinaryExpression]: convertBinaryExpression,
        [tsm.SyntaxKind.CallExpression]: convertCallExpression,
        [tsm.SyntaxKind.Identifier]: convertIdentifier,
        [tsm.SyntaxKind.NumericLiteral]: convertNumericLiteral,
        [tsm.SyntaxKind.PropertyAccessExpression]: convertPropertyAccessExpression,
        [tsm.SyntaxKind.StringLiteral]: convertStringLiteral,
    })

    function dispatch<TKind extends tsm.SyntaxKind>(kind: TKind, convertMap: NodeConvertMap) {
        const converter = convertMap[kind];
        if (converter) {
            converter(node.asKindOrThrow(kind), options);
        } else {
            throw new CompileError(`${tsm.SyntaxKind[kind]} not supported`, node)
        }
    }
}

export function parseArrayLiteral(node: tsm.ArrayLiteralExpression) {
    const bytes = new Array<number>();
    for (const element of node.getElements()) {
        if (tsm.Node.isNumericLiteral(element)) {
            const value = element.getLiteralValue();
            if (Number.isInteger(value) && value >= 0 && value <= 255) {
                bytes.push(value);
            } else {
                return undefined;
            }
        } else {
            return undefined;
        }
    }
    return Uint8Array.from(bytes);
}

// [SyntaxKind.ArrayLiteralExpression]: ArrayLiteralExpression;
// function convertArrayLiteralExpression(node: tsm.ArrayLiteralExpression, options: ConverterOptions) {
//     const { builder } = options;

//     const buffer = parseArrayLiteral(node);
//     if (buffer) {
//         builder.push(convertBuffer(buffer));
//         builder.push(sc.OpCode.CONVERT, [sc.StackItemType.Buffer])
//         return;
//     } 

//     throw new CompileError(`convertArrayLiteral not implemented`, node);
// }

// [SyntaxKind.ArrowFunction]: ArrowFunction;

// [SyntaxKind.AsExpression]: AsExpression;
// function convertAsExpression(node: tsm.AsExpression, ctx: OperationContext): Instruction[] {
//     const ins = convertExpression(node.getExpression(), ctx);
//     const type = tsTypeToContractType(node.getType());
//     if (isPrimitiveType(type)) {
//         if (type.type === PrimitiveType.Integer) {
//             ins.push({ 
//                 opCode: sc.OpCode.CONVERT, 
//                 operand: Uint8Array.from([sc.StackItemType.Integer])
//             });
//         } else {
//             throw new Error(`asExpression ${PrimitiveType[type.type]} primitive not implemented`)
//         }
//     } else {
//         throw new Error(`asExpression ${ContractTypeKind[type.kind]} kind not implemented`)
//     }
//     return ins;

// }

// [SyntaxKind.AwaitExpression]: AwaitExpression;

// [SyntaxKind.BigIntLiteral]: BigIntLiteral;
function convertBigIntLiteral(node: tsm.BigIntLiteral, options: ConverterOptions) {
    const { builder } = options;
    const literal = node.getLiteralValue() as bigint;
    builder.pushInt(literal);
}

// [SyntaxKind.BinaryExpression]: BinaryExpression;
function convertBinaryExpression(node: tsm.BinaryExpression, options: ConverterOptions) {
    const { builder } = options;

    const left = node.getLeft();
    const right = node.getRight();
    const opCode = convertBinaryOperator(
        node.getOperatorToken(),
        left.getType(),
        right.getType()
    );

    convertExpression(left, options);
    convertExpression(right, options);
    builder.push(opCode);

    function convertBinaryOperator(
        op: tsm.Node<tsm.ts.BinaryOperatorToken>,
        left: tsm.Type,
        right: tsm.Type
    ): OpCode {
        switch (op.getKind()) {
            case tsm.SyntaxKind.EqualsEqualsToken:
            case tsm.SyntaxKind.EqualsEqualsEqualsToken: {
                if (isBigIntLike(left) && isBigIntLike(right)) {
                    return OpCode.NUMEQUAL;
                }
                throw new Error(`convertBinaryOperator.${op.getKindName()} not implemented for ${left.getText()} and ${right.getText()}`);
            }
            case tsm.SyntaxKind.LessThanToken: return OpCode.LT;
            case tsm.SyntaxKind.PlusToken: {
                if (isStringLike(left) && isStringLike(right)) {
                    return OpCode.CAT;
                }
                throw new Error(`convertBinaryOperator.PlusToken not implemented for ${left.getText()} and ${right.getText()}`);
            }
            default:
                throw new Error(`convertOperator ${op.getKindName()} not implemented`);
        }
    }
}

// [SyntaxKind.CallExpression]: CallExpression;
function convertCallExpression(node: tsm.CallExpression, options: ConverterOptions) {
    // const { context: { builtins } } = options;

    const expr = node.getExpression();
    if (tsm.Node.isPropertyAccessExpression(expr)) {
        const func = resolveSymbol(expr.getNameNode().getSymbol(), options);
        if (func) {
            func(node, options);
            return;
        }
    }

    throw new CompileError('convertCallExpression not implemented', node);
}

// [SyntaxKind.ClassExpression]: ClassExpression;
// [SyntaxKind.CommaListExpression]: CommaListExpression;
// [SyntaxKind.ConditionalExpression]: ConditionalExpression;
// [SyntaxKind.DeleteExpression]: DeleteExpression;
// [SyntaxKind.ElementAccessExpression]: ElementAccessExpression;
// [SyntaxKind.FunctionExpression]: FunctionExpression;
// [SyntaxKind.Identifier]: Identifier;
function convertIdentifier(node: tsm.Identifier, options: ConverterOptions) {
    const { builder, info } = options;

    // Not sure this is the best way to generally resolve identifiers,
    // but it works for parameters

    const func = resolveSymbol(node.getSymbol(), options);
    if (func) {
        func(node, options);
        return;
    }

    // const symbol = node.getSymbol();
    // if (symbol) {
    //     const decl = symbol.getValueDeclaration();
    //     if (decl) {
    //         if (tsm.Node.isParameterDeclaration(decl)) {
    //             const index = info.node.getParameters()
    //                 .findIndex(p => p.getSymbol() === symbol);
    //             if (index >= 0) {
    //                 builder.pushLoad(SlotType.Parameter, index);
    //                 return;
    //             }
    //         }
    //     }
    // }

    throw new CompileError('convertIdentifier not implemented', node);
}

// [SyntaxKind.JsxClosingFragment]: JsxClosingFragment;
// [SyntaxKind.JsxElement]: JsxElement;
// [SyntaxKind.JsxExpression]: JsxExpression;
// [SyntaxKind.JsxFragment]: JsxFragment;
// [SyntaxKind.JsxOpeningElement]: JsxOpeningElement;
// [SyntaxKind.JsxOpeningFragment]: JsxOpeningFragment;
// [SyntaxKind.JsxSelfClosingElement]: JsxSelfClosingElement;
// [SyntaxKind.MetaProperty]: MetaProperty;
// [SyntaxKind.NewExpression]: NewExpression;
// [SyntaxKind.NonNullExpression]: NonNullExpression;
// [SyntaxKind.NoSubstitutionTemplateLiteral]: NoSubstitutionTemplateLiteral;
// [SyntaxKind.NumericLiteral]: NumericLiteral;
function convertNumericLiteral(node: tsm.NumericLiteral, options: ConverterOptions) {
    const { builder } = options;
    const literal = node.getLiteralValue();
    if (!Number.isInteger(literal)) throw new CompileError(`invalid non-integere numeric literal`, node);
    builder.pushInt(literal);
}

// [SyntaxKind.ObjectLiteralExpression]: ObjectLiteralExpression;
// [SyntaxKind.OmittedExpression]: OmittedExpression;
// [SyntaxKind.ParenthesizedExpression]: ParenthesizedExpression;
// [SyntaxKind.PartiallyEmittedExpression]: PartiallyEmittedExpression;
// [SyntaxKind.PostfixUnaryExpression]: PostfixUnaryExpression;
// [SyntaxKind.PrefixUnaryExpression]: PrefixUnaryExpression;
// [SyntaxKind.PropertyAccessExpression]: PropertyAccessExpression;
function convertPropertyAccessExpression(node: tsm.PropertyAccessExpression, options: ConverterOptions) {
    const func = resolveSymbol(node.getNameNode().getSymbol(), options);
    if (func) {
        func(node, options);
        return;
    }
    throw new CompileError(`convertPropertyAccessExpression not implemented`, node);
}

// [SyntaxKind.RegularExpressionLiteral]: RegularExpressionLiteral;
// [SyntaxKind.SpreadElement]: SpreadElement;
// [SyntaxKind.StringLiteral]: StringLiteral;
function convertStringLiteral(node: tsm.StringLiteral, options: ConverterOptions) {
    const { builder } = options;

    const literal = node.getLiteralValue();
    builder.pushData(literal);
}

// [SyntaxKind.TaggedTemplateExpression]: TaggedTemplateExpression;
// [SyntaxKind.TemplateExpression]: TemplateExpression;
// [SyntaxKind.TypeAssertionExpression]: TypeAssertion;
// [SyntaxKind.TypeOfExpression]: TypeOfExpression;
// [SyntaxKind.YieldExpression]: YieldExpression;
// [SyntaxKind.AnyKeyword]: Expression;
// [SyntaxKind.BooleanKeyword]: Expression;
// [SyntaxKind.NumberKeyword]: Expression;
// [SyntaxKind.ObjectKeyword]: Expression;
// [SyntaxKind.StringKeyword]: Expression;
// [SyntaxKind.SymbolKeyword]: Expression;
// [SyntaxKind.UndefinedKeyword]: Expression;
// [SyntaxKind.FalseKeyword]: FalseLiteral;
// [SyntaxKind.ImportKeyword]: ImportExpression;
// [SyntaxKind.NullKeyword]: NullLiteral;
// [SyntaxKind.SuperKeyword]: SuperExpression;
// [SyntaxKind.ThisKeyword]: ThisExpression;
// [SyntaxKind.TrueKeyword]: TrueLiteral;
// [SyntaxKind.VoidExpression]: VoidExpression;


