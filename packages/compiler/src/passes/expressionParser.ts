import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { transform } from "../utility/nodeDispatch";

export type ParseResult = boolean | bigint | ByteString;

class NeoBuffer extends Uint8Array {
    constructor(array: ArrayLike<number> | ArrayBufferLike) {
        super(array);
    }
}

export class ByteString extends Uint8Array {
    constructor(array: ArrayLike<number> | ArrayBufferLike) {
        super(array);
    }
}

// function isConstantValue(result: ParseResult): result is ConstantValue {
//     switch (typeof result) {
//         case 'bigint':
//         case 'boolean':
//         case 'number':
//             return true;
//         case 'object':
//             return result instanceof Uint8Array;
//         default:
//             return false;
//     }
// }

export function parseExpression(node: tsm.Expression): ParseResult {

    return transform<ParseResult>(node, {
        // [tsm.SyntaxKind.ArrayLiteralExpression]: (node) => {

        //     // const type = node.getType();
        //     // if (type.isArray()) {

        //     // }
        //     // const isArray = ;
        //     // const isNumber = type.getArrayElementType()?.isNumber();
        //     // const flags = tsm.ts.TypeFlags[type.getFlags()];

        //     // const args = type.getTypeArguments();
        //     // const allNumberLike = args.every(a => isNumberLike(a));

        //     const results = new Array<ParseResult>();
        //     for (const element of node.getElements()) {
        //         results.push(parseExpression(element));
        //     }
        //     return results;
        // },
        // [tsm.SyntaxKind.AsExpression]: (node) => {
        //     const expr = node.getExpression();
        //     const value = parseExpression(expr);
        //     const typeNode = node.getTypeNodeOrThrow();
        //     if (isConst(typeNode)) {
        //         if (isConstantValue(value)) { return value; }
        //         const type = expr.getType();
        //         const typeArgs = type.getTypeArguments();
        //         if (typeArgs.)
        //     } 

        //     throw new CompileError(`parseExpression as ${typeNode.print()} not implemented`, node);
        // },
        [tsm.SyntaxKind.BigIntLiteral]: (node) => {
            return node.getLiteralValue() as bigint;
        },
        [tsm.SyntaxKind.FalseKeyword]: (node) => {
            return node.getLiteralValue();
        },
        [tsm.SyntaxKind.NumericLiteral]: (node) => {
            const literal = node.getLiteralValue();
            if (!Number.isInteger(literal)) throw new CompileError(`invalid non-integer numeric literal`, node);
            return BigInt(literal);
        },
        [tsm.SyntaxKind.StringLiteral]: (node) => {
            const buffer = Buffer.from(node.getLiteralValue(), 'utf-8');
            return new ByteString(buffer);
        },
        [tsm.SyntaxKind.TrueKeyword]: (node, context) => {
            return node.getLiteralValue();
        },
    });
}

// [tsm.SyntaxKind.ArrayLiteralExpression]: processArrayLiteralExpression,
// [tsm.SyntaxKind.BinaryExpression]: processBinaryExpression,
// [tsm.SyntaxKind.CallExpression]: processCallExpression,
// [tsm.SyntaxKind.Identifier]: processIdentifier,
// [tsm.SyntaxKind.PropertyAccessExpression]: processPropertyAccessExpression,
