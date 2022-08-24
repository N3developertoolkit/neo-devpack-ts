import { KindToNodeMappings, SyntaxKind } from 'ts-morph';
// import { configureProject } from '../src/compiler';

// export function testCompileNode<TKind extends SyntaxKind>(text: string, kind: TKind): KindToNodeMappings[TKind] {
//     const { sourceFile } = testCompile(text);
//     return sourceFile.getFirstDescendantByKindOrThrow(kind);
// }

// export function testCompile(text: string) {
//     const project = configureProject();
//     const sourceFile = project.createSourceFile("fake.ts", text);
//     return { project, sourceFile };
// }
