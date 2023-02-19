import { createDiagnostic } from "./utils";
import { FunctionDeclaration, InterfaceDeclaration, VariableDeclaration, SourceFile, Node, Project, ts } from "ts-morph";
import { pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as O from 'fp-ts/Option';
import * as M from 'fp-ts/Monoid'
import { ParserState } from "./compiler";

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

function parseLibSourceFile(src: SourceFile): [ReadonlyArray<string>, State] {
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

    const state = { functions, interfaces, variables };
    return [references, state];
}

export const parseProjectLib = (project: Project): ParserState<State> =>
    (diagnostics: ReadonlyArray<ts.Diagnostic>) => {

    const diagMonoid = ROA.getMonoid<ts.Diagnostic>();
    const LIB_PATH = `/node_modules/typescript/lib/`;
    const loadSource = (filename: string) => project.getSourceFile(LIB_PATH + filename);

    let state = stateMonoid.empty;
    const sources = project.compilerOptions.get().lib ?? [];
    const parsedFiles = new Set<string>();

    while (sources.length > 0) {
        const head = sources.shift()!;
        if (parsedFiles.has(head))
            continue;
        parsedFiles.add(head);
        const src = loadSource(head);
        if (src) {
            const [srcRefs, srcState] = parseLibSourceFile(src);
            state = stateMonoid.concat(state, srcState);
            srcRefs.forEach(r => sources.push(r));
        } else {
            const diag = createDiagnostic(`failed to load ${head}`);
            diagnostics = diagMonoid.concat(diagnostics, [diag]);
        }
    }

    return [state, diagnostics];
}
