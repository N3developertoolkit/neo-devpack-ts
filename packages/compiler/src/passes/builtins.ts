import * as tsm from "ts-morph";
import { CompileError } from "../compiler";
import { ConstantSymbolDef } from "../scope";
import { ProcessMethodOptions } from "./processFunctionDeclarations";

export function emitU8ArrayFrom(args: ReadonlyArray<tsm.Expression>, options: ProcessMethodOptions): void {
    if (args.length === 0) throw new Error("Invalid arg count");
    const arg = args[0];
    const buffer = new Array<number>();
    if (tsm.Node.isArrayLiteralExpression(arg)) {
        for (const elem of arg.getElements()) {
            switch (elem.getKind()) {
                case tsm.SyntaxKind.BigIntLiteral: {
                    const value = (elem as tsm.BigIntLiteral).getLiteralValue() as bigint;
                    buffer.push(Number(value));
                }
                break;
                case tsm.SyntaxKind.NumericLiteral: {
                    const value = (elem as tsm.NumericLiteral).getLiteralValue();
                    buffer.push(value);
                }
                break;
                case tsm.SyntaxKind.Identifier: {
                    const resolved = options.scope.resolve(elem.getSymbol());
                    if (resolved instanceof ConstantSymbolDef
                        && typeof resolved.value === 'bigint'
                    ) {
                        buffer.push(Number(resolved.value));
                    } else {
                        throw new CompileError('unsupported array identifier', elem);
                    }
                }
                break;
                default:
                    throw new CompileError(`Unsupported array literal element type ${elem.getKindName()}`, elem);
            }
        }
    } else {
        throw new CompileError('not implemented', arg);
    }
    const data = Uint8Array.from(buffer);
    options.builder.emitPushData(data);
}