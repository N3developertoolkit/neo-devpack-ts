

// interface LibState {
//     readonly functions: ReadonlyArray<FunctionDeclaration>,
//     readonly interfaces: ReadonlyArray<InterfaceDeclaration>,
//     readonly variables: ReadonlyArray<VariableDeclaration>
// }

import { FunctionDeclaration, InterfaceDeclaration, Node, Project, SourceFile, VariableDeclaration } from "ts-morph";
import { flow, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RONEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as M from 'fp-ts/Monoid'

type State = {
    readonly functions: ReadonlyArray<FunctionDeclaration>,
    readonly interfaces: ReadonlyArray<InterfaceDeclaration>,
    readonly variables: ReadonlyArray<VariableDeclaration>,
}


const stateMonoid: M.Monoid<State> = {
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

type LibParse<A> = S.State<State, A>;

const parseFoo =
    (src: SourceFile): LibParse<ReadonlyArray<string>> =>
        (current: State) => {
            const children = src.forEachChildAsArray();
            const functions = pipe(children,
                ROA.filterMap(node => Node.isFunctionDeclaration(node)
                    ? O.some(node) : O.none),
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

            const newState = stateMonoid.concat(current, {
                functions, interfaces, variables
            })

            return [references, newState]
        }

export const parseProjectLib =
    (project: Project) => {

        const LIB_PATH = `/node_modules/typescript/lib/`;

        const libSources = pipe(
            project.compilerOptions.get().lib,
            O.fromNullable,
            O.getOrElse(() => [] as ReadonlyArray<string>)
        )

        const loadSource = (filename: string) => pipe(project.getSourceFile(LIB_PATH + filename), O.fromNullable);

        let state = stateMonoid.empty;
        let sources = libSources;
        const sourceMap = new Set<string>();

        while (sources.length > 0) {
            const head = sources[0];
            sources = sources.slice(1);
            if (sourceMap.has(head)) {
                continue;
            }
            sourceMap.add(head);
            const src = loadSource(head);
            if (O.isSome(src)) {
                const [refs, newState] = parseFoo(src.value)(state);
                state = newState;
                sources = sources.concat(refs);
            }
        }

        return state;

    }
