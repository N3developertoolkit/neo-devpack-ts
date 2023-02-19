import { createDiagnostic } from "./utils";
import { FunctionDeclaration, InterfaceDeclaration, VariableDeclaration, SourceFile, Node, Project, ts } from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as O from 'fp-ts/Option';
import * as M from 'fp-ts/Monoid'
import { ParserState } from "./compiler";
import * as S from 'fp-ts/State';

export type LibraryDeclarations = {
    readonly functions: ReadonlyArray<FunctionDeclaration>,
    readonly interfaces: ReadonlyArray<InterfaceDeclaration>,
    readonly variables: ReadonlyArray<VariableDeclaration>,
}

const declarationsMonoid: M.Monoid<LibraryDeclarations> = {
    concat: (x, y) => ({
        functions: x.functions.concat(y.functions),
        interfaces: x.interfaces.concat(y.interfaces),
        variables: x.variables.concat(y.variables),
    }),
    empty: {
        functions: [],
        interfaces: [],
        variables: []
    }
}

const parseLibrarySourceFile =
    (src: SourceFile): S.State<LibraryDeclarations, ReadonlyArray<string>> =>
        (declarations: LibraryDeclarations) => {
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

            declarations = declarationsMonoid.concat(
                declarations,
                { functions, interfaces, variables }
            );
            return [references, declarations];
        }


export const parseProjectLibrary =
    (project: Project): ParserState<LibraryDeclarations> =>
        (diagnostics: ReadonlyArray<ts.Diagnostic>) => {
            const LIB_PATH = `/node_modules/typescript/lib/`;
            const loadSource = (filename: string) => project.getSourceFile(LIB_PATH + filename);

            let state = declarationsMonoid.empty;
            const sources = project.compilerOptions.get().lib ?? [];
            const parsedFiles = new Set<string>();
            const loadFailures = new Array<string>();

            while (sources.length > 0) {
                const head = sources.shift()!;
                if (parsedFiles.has(head))
                    continue;
                parsedFiles.add(head);
                const src = loadSource(head);
                if (src) {
                    let srcRefs: ReadonlyArray<string>;
                    [srcRefs, state] = parseLibrarySourceFile(src)(state);
                    srcRefs.forEach(r => sources.push(r));
                } else {
                    loadFailures.push(head);
                }
            }

            diagnostics = ROA.getMonoid<ts.Diagnostic>().concat(
                diagnostics,
                loadFailures.map(f => createDiagnostic(`failed to load ${f} library file`))
            );

            return [state, diagnostics];
        }
