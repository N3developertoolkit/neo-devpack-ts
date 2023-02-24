import { createDiagnostic } from "./utils";
import { FunctionDeclaration, InterfaceDeclaration, VariableDeclaration, SourceFile, Node, Project, ts } from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as O from 'fp-ts/Option';
import * as M from 'fp-ts/Monoid'
import { CompilerState } from "./compiler";
import * as S from 'fp-ts/State';
import * as FP from 'fp-ts';
import * as ROS from 'fp-ts/ReadonlySet';
import * as E from 'fp-ts/Either';
import { fail } from "assert";

type Diagnostic = ts.Diagnostic;

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

const LIB_PATH = `/node_modules/typescript/lib/`;

// TODO: At some point, I should rewrite this to be functional and recursive
export const parseProjectLibrary =
    (project: Project): CompilerState<LibraryDeclarations> =>
        (diagnostics: ReadonlyArray<Diagnostic>) => {
            const loadSource = (filename: string) => project.getSourceFile(LIB_PATH + filename);
            const strEq = FP.string.Eq;

            let state = declarationsMonoid.empty;
            let sources = ROA.fromArray(project.compilerOptions.get().lib ?? []);
            let parsed: ReadonlySet<string> = ROS.empty;
            let failures: ReadonlyArray<Diagnostic> = ROA.empty;
            let declarations = declarationsMonoid.empty;

            while (ROA.isNonEmpty(sources)) {
                const head = RNEA.head(sources);
                sources = RNEA.tail(sources);
                if (ROS.elem(strEq)(head)(parsed)) continue;
                parsed = ROS.insert(strEq)(head)(parsed);

                const src = loadSource(head);
                if (src) {
                    let references;
                    [references, declarations] = parseLibrarySourceFile(src)(declarations);
                    sources = ROA.concat(references)(sources);
                } else {
                    failures = ROA.append(createDiagnostic(`failed to load ${head} library file`))(failures);
                }
            }

            return [state,  ROA.concat(failures)(diagnostics)];
        }
