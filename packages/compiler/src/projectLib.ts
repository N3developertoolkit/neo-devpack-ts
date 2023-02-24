import { FunctionDeclaration, InterfaceDeclaration, VariableDeclaration, SourceFile, Node, Project, ts } from "ts-morph";
import { createDiagnostic } from "./utils";
import { CompilerState } from "./compiler";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as ROS from 'fp-ts/ReadonlySet';
import * as STR from 'fp-ts/string'

type Diagnostic = ts.Diagnostic;

export type LibraryDeclarations = {
    readonly functions: ReadonlyArray<FunctionDeclaration>,
    readonly interfaces: ReadonlyArray<InterfaceDeclaration>,
    readonly variables: ReadonlyArray<VariableDeclaration>,
}

const parseLibrarySourceFile =
    (src: SourceFile): S.State<LibraryDeclarations, ReadonlyArray<string>> =>
        declarations => {
            const children = src.forEachChildAsArray();
            const functions = pipe(children,
                ROA.filterMap(node => Node.isFunctionDeclaration(node)
                    ? O.some(node) : O.none)
            );
            const interfaces = pipe(children,
                ROA.filterMap(node => Node.isInterfaceDeclaration(node)
                    ? O.some(node) : O.none)
            );
            const variables = pipe(children,
                ROA.filterMap(node => Node.isVariableStatement(node)
                    ? O.some(node.getDeclarations()) : O.none),
                ROA.flatten
            );
            const references = pipe(
                src.getLibReferenceDirectives(),
                ROA.map(ref => `lib.${ref.getFileName()}.d.ts`)
            );

            return [references, {
                functions: ROA.concat(functions)(declarations.functions),
                interfaces: ROA.concat(interfaces)(declarations.interfaces),
                variables: ROA.concat(variables)(declarations.variables),
            }];
        }

const LIB_PATH = `/node_modules/typescript/lib/`;

export const parseProjectLibrary =
    (project: Project): CompilerState<LibraryDeclarations> =>
        diagnostics => {
            const loadSource = (filename: string) => project.getSourceFile(LIB_PATH + filename);

            let sources = ROA.fromArray(project.compilerOptions.get().lib ?? []);
            let declarations: LibraryDeclarations = {
                functions: ROA.empty,
                interfaces: ROA.empty,
                variables: ROA.empty
            }
            let parsed: ReadonlySet<string> = ROS.empty;
            let failures: ReadonlyArray<Diagnostic> = ROA.empty;

            while (ROA.isNonEmpty(sources)) {
                const head = RNEA.head(sources);
                sources = RNEA.tail(sources);
                if (ROS.elem(STR.Eq)(head)(parsed)) continue;
                parsed = ROS.insert(STR.Eq)(head)(parsed);

                const src = loadSource(head);
                if (src) {
                    let references;
                    [references, declarations] = parseLibrarySourceFile(src)(declarations);
                    sources = ROA.concat(references)(sources);
                } else {
                    failures = ROA.append(createDiagnostic(`failed to load ${head} library file`))(failures);
                }
            }

            return [declarations, ROA.concat(failures)(diagnostics)];
        }
