import * as tsm from "ts-morph";
import { BuiltinCall, builtins as builtinDefinitions } from "../builtins";
import { CompileContext } from "../types/CompileContext";

export function resolveDeclarationsPass(context: CompileContext): void {

    const symbols = new Map<tsm.Symbol, BuiltinCall>();

    for (const declFile of context.declarationFiles) {
        declFile.forEachChild(node => {
            if (node.isKind(tsm.SyntaxKind.InterfaceDeclaration)) {
                const symbol = node.getSymbol();
                if (!symbol)
                    return;

                const iface = builtinDefinitions[symbol.getName()];
                if (iface) {
                    for (const member of node.getMembers()) {
                        const memberSymbol = member.getSymbol();
                        if (!memberSymbol)
                            return;
                        const call = iface[memberSymbol.getName()];
                        if (call) {
                            symbols.set(memberSymbol, call);
                        }
                    }
                }
            }
        });
    }

    context.builtins = { symbols };
}
