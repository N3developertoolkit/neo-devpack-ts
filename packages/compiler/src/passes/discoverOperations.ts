import * as tsm from "ts-morph";
import { CompileContext } from "../types/CompileContext";

export function discoverOperationsPass(context: CompileContext): void {
    const { operations = [] } = context;
    for (const src of context.project.getSourceFiles()) {
        if (src.isDeclarationFile()) { continue; }

        src.forEachChild(node => {
            if (tsm.Node.isFunctionDeclaration(node)) {
                const tags = node.getJsDocs().flatMap(d => d.getTags());
                const name = node.getName();
                if (name) {
                    const safe = tags.findIndex(t => t.getTagName() === 'safe') >= 0;
                    const parameters = node.getParameters()
                        .map((p, index) => ({
                            node: p,
                            name: p.getName(),
                            type: p.getType(),
                            index
                        }));
                    operations.push({
                        node, name, safe,
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
