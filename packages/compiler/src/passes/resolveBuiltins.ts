import * as tsm from "ts-morph";
import { builtins, ConvertFunction } from "../builtins";
import { CompileContext } from "../types/CompileContext";

export interface Builtins {
    // variables: ReadonlyMap<tsm.Symbol, tsm.Symbol>,
    // interfaces: ReadonlyMap<tsm.Symbol, Map<tsm.Symbol, VmCall[]>>,
    symbols: Map<tsm.Symbol, ConvertFunction>,
}

export function resolveBuiltinsPass(context: CompileContext): void {

    const symbols = new Map<tsm.Symbol, ConvertFunction>();

    for (const declFile of context.declarationFiles) {
        declFile.forEachChild(node => {
            if (node.isKind(tsm.SyntaxKind.InterfaceDeclaration)) {
                const symbol = node.getSymbol();
                if (!symbol) { return; }

                const iface = builtins[symbol.getName()];
                if (iface) {
                    for (const member of node.getMembers()) {
                        const memberSymbol = member.getSymbol();
                        if (!memberSymbol) { return; }
                        const func = iface[memberSymbol.getName()];
                        if (func) {
                            symbols.set(memberSymbol, func);
                        }
                    }
                }
            }
        });
    }

    context.builtins = { symbols };
}
