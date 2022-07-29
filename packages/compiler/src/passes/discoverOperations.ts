import * as tsm from "ts-morph";
import { CompileContext } from "../types/CompileContext";

export function discoverOperationsPass(context: CompileContext): void {
    const { operations = [] } = context;
    for (const src of context.project.getSourceFiles()) {
        if (src.isDeclarationFile()) { continue; }

        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                const name = node.getName();
                const parameters = node.getParameters()
                    .map((p, index) => ({
                        node: p,
                        name: p.getName(),
                        type: p.getType(),
                        index
                    }));
                if (name) {
                    operations.push({
                        node, name,
                        isPublic: !!node.getExportKeyword(),
                        parameters,
                        returnType: node.getReturnType(),
                    });
                }
            }
        });
    }
    context.operations = operations;   
}
