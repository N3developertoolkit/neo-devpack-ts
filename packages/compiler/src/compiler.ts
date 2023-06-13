import * as tsm from "ts-morph";
import { identity, pipe } from "fp-ts/lib/function";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as TS from './TS'
import * as E from 'fp-ts/Either'
import * as STR from 'fp-ts/string'

import { collectProjectDeclarations } from "./collectProjectDeclarations";
import { collectArtifacts } from "./collectArtifacts";
import { makeGlobalScope } from "./builtin";
import { parseProject } from "./passes/sourceFileProcessor";
import { CompileArtifacts } from "./types/CompileOptions";
import { createDiagnostic } from "./utils";

export const DEFAULT_ADDRESS_VALUE = 53;

export interface CompilerOptions {
    readonly baseName: string;
    readonly contractName?: string;
    readonly standards?: readonly string[];
    // readonly addressVersion?: number;
    // readonly inline?: boolean;
    // readonly optimize?: boolean;
}

export function compile(
    project: tsm.Project,
    options: CompilerOptions
): CompileArtifacts {

    const jsdocableNodes = pipe(
        project.getSourceFiles(),
        ROA.filter(src => !src.isDeclarationFile()),
        ROA.chain(src => src.forEachChildAsArray()),
        ROA.filterMap(O.fromPredicate(tsm.Node.isJSDocable))
    )

    const contractName = pipe(
        // if the contract name is specified in options, use it
        options.contractName,
        O.fromNullable,
        // if the contract name is not specified, look for a contract tag to use instead
        O.alt(() => {
            return pipe(
                jsdocableNodes,
                ROA.map(TS.getTagComment('contract')),
                ROA.filterMap(identity),
                ROA.head,
            );
        }),
        // if the contract name is not specified in options or a JSDoc tag, 
        // fallback to using the base name
        O.getOrElse(() => options.baseName),
    )

    if (contractName.length === 0) {
        const diagnostics = ROA.of(createDiagnostic("Contract name is not specified"));
        return { diagnostics };
    }

    const { left: ignoredStandards, right: standards } = pipe(
        // get all the standards specified in options and doc tags
        jsdocableNodes,
        ROA.chain(TS.getTagComments('standard')),
        ROA.concat(options.standards ?? []),
        // remove duplicates
        ROA.uniq(STR.Eq),
        // standards must start with "NEP-" and be followed by an integer
        ROA.map(std => {
            if (std.startsWith('NEP-')) {
                const nep = parseInt(std.slice(4));
                if (!isNaN(nep)) {
                    return E.of(std);
                }
            }
            // warn about invalid standards, but don't fail compilation
            return E.left(createDiagnostic(`ignoring invalid NEP standard ${std}`, { category: tsm.DiagnosticCategory.Warning }));
        }),
        ROA.separate
    )

    const extras = pipe(
        jsdocableNodes,
        ROA.chain(TS.getTagComments('extra')),
        ROA.map(extra => {
            const index = extra.trim().indexOf(':');
            // if there is no colon, treat the whole string as the value
            if (index < 0) { return ["", extra] as const; }
            const key = extra.slice(0, index).trim();
            const value = extra.slice(index + 1).trim();
            return [key, value] as const;
        }),
        // filter out extras without a key
        ROA.filter(([ key ]) => key.length > 0),
        // filter out extras with duplicate keys
        ROA.uniq({ equals: (a, b) => a[0] === b[0], })
    )

    let [{ compiledProject, artifacts }, diagnostics] = pipe(
        project.getPreEmitDiagnostics(),
        ROA.map(d => d.compilerObject),
        pipe(
            collectProjectDeclarations(project),
            S.chain(makeGlobalScope),
            S.chain(parseProject(project)),
            S.bindTo('compiledProject'),
            S.bind('artifacts', ({ compiledProject }) => collectArtifacts({ contractName, standards, extras })(compiledProject))
        ),
    );

    diagnostics = ROA.concat(diagnostics)(ignoredStandards);
    return { diagnostics, compiledProject, ...artifacts };
}

