import { InMemoryFileSystemHost, KindToNodeMappings, Project, SyntaxKind, ts } from 'ts-morph';

export function fakeCompileNode<TKind extends SyntaxKind>(text: string, kind: TKind): KindToNodeMappings[TKind] {
    const { sourceFile } = fakeCompile(text);
    return sourceFile.getFirstDescendantByKindOrThrow(kind);
}

export function fakeCompile(text: string) {
    const project = new Project({
        compilerOptions: {
            target: ts.ScriptTarget.ES5
        },
        fileSystem: new InMemoryFileSystemHost()
    });
    const sourceFile = project.createSourceFile("fake.ts", text);
    return { project, sourceFile };
}
