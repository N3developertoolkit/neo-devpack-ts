import * as tsm from "ts-morph";
import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import * as TS from './utility/TS'
import { State } from 'fp-ts/State';
import { empty as ROS_empty, elem as ROS_elem, insert as ROS_insert } from 'fp-ts/ReadonlySet';
import { Json, JsonRecord, parse } from "fp-ts/Json";
import { lookup as ROR_lookup } from 'fp-ts/ReadonlyRecord';
import { Eq as STR_Eq } from 'fp-ts/string';
import { posix } from 'path';

import { createDiagnostic } from "./utils";
import { CompilerState } from "./types/CompileOptions";

function isJsonRecord(json: Json): json is JsonRecord {
    return json !== null && typeof json === 'object' && !(json instanceof Array);
}

function isJsonString(json: Json): json is string {
    return typeof json === 'string';
}

function getFileReferenceName(file: tsm.FileReference) { 
    return file.getFileName(); 
}

export type LibraryDeclaration = 
    tsm.EnumDeclaration | 
    tsm.FunctionDeclaration | 
    tsm.InterfaceDeclaration | 
    tsm.TypeAliasDeclaration |
    tsm.VariableStatement;

const collectDeclarations =
    (resolver: Resolver) =>
        (node: tsm.Node): readonly LibraryDeclaration[] => {

            let declarations: readonly LibraryDeclaration[] = ROA.empty;

            node.forEachChild(child => {
                switch (child.getKind()) {
                    case tsm.SyntaxKind.EnumDeclaration:
                    case tsm.SyntaxKind.FunctionDeclaration:
                    case tsm.SyntaxKind.InterfaceDeclaration:
                    case tsm.SyntaxKind.TypeAliasDeclaration:
                    case tsm.SyntaxKind.VariableStatement:
                        declarations = ROA.append(child as LibraryDeclaration)(declarations);
                        break;

                    case tsm.SyntaxKind.ModuleDeclaration: {
                        const body = (child as tsm.ModuleDeclaration).getBody();
                        const modDecls = body ? collectDeclarations(resolver)(body) : [];
                        declarations = ROA.concat(modDecls)(declarations);
                        break;
                    }

                    case tsm.SyntaxKind.ExportDeclaration: {
                        const exports = (child as tsm.ExportDeclaration).getNamedExports();
                        if (ROA.isNonEmpty(exports)) {
                            throw new Error('non empty ExportDeclaration')
                        }
                        break;
                    }

                    case tsm.SyntaxKind.EndOfFileToken:
                        break;

                    default:
                        throw new Error(`collectDeclarations ${child.getKindName()}`)
                }
            })

            return declarations;
        }

const collectSourceFileDeclarations =
    (resolver: Resolver) =>
        (src: tsm.SourceFile): State<readonly LibraryDeclaration[], ReadonlyArray<E.Either<string, tsm.SourceFile>>> =>
            declarations => {

                const libs = pipe(
                    src.getLibReferenceDirectives(),
                    ROA.map(getFileReferenceName));
                const types = pipe(
                    src.getTypeReferenceDirectives(),
                    ROA.map(getFileReferenceName));
                const $declarations = collectDeclarations(resolver)(src);

                return [
                    resolveReferences(resolver)(libs, types),
                    ROA.concat($declarations)(declarations)
                ];
            }

export const collectProjectDeclarations =
    (project: tsm.Project): CompilerState<readonly LibraryDeclaration[]> =>
        diagnostics => {
            const resolver = makeResolver(project);
            const $parseLibrarySourceFile = collectSourceFileDeclarations(resolver);

            const opts = project.compilerOptions.get();
            let { left: failures, right: sources } = pipe(
                opts,
                opts => resolveReferences(resolver)(opts.lib ?? [], opts.types ?? []),
                ROA.partitionMap(identity)
            )
            let parsed: ReadonlySet<string> = ROS_empty;
            let declarations: readonly LibraryDeclaration[] = ROA.empty;

            while (ROA.isNonEmpty(sources)) {
                pipe(
                    sources,
                    RNEA.matchLeft((head, tail) => {
                        sources = tail;
                        const headPath = head.getFilePath();
                        if (ROS_elem(STR_Eq)(headPath)(parsed)) return;
                        parsed = ROS_insert(STR_Eq)(headPath)(parsed);

                        let results;
                        [results, declarations] = $parseLibrarySourceFile(head)(declarations);

                        const { left: $failures, right: $sources } = pipe(results, ROA.partitionMap(identity));
                        failures = ROA.concat($failures)(failures);
                        sources = ROA.concat($sources)(sources);
                    })
                )
            }

            const $diagnostics = pipe(failures, ROA.map(createDiagnostic));
            return [declarations, ROA.concat($diagnostics)(diagnostics)];
        }

interface Resolver {
    resolveLib(lib: string): E.Either<string, tsm.SourceFile>,
    resolveTypes(types: string): E.Either<string, tsm.SourceFile>,
}

function resolveReferences(resolver: Resolver) {
    return (libs: ReadonlyArray<string>, types: ReadonlyArray<string>) => {
        const resolvedLibs = pipe(libs, ROA.map(resolver.resolveLib));
        const resolbedTypes = pipe(types, ROA.map(resolver.resolveTypes));
        return ROA.concat(resolvedLibs)(resolbedTypes);
    };
}

const LIB_PATH = `/node_modules/typescript/lib/`;

function makeResolver(project: tsm.Project): Resolver {

    const fs = project.getFileSystem();
    const getSourceFile = (path: string) => pipe(project.getSourceFile(path), O.fromNullable);
    const getFile = (path: string) => fs.fileExistsSync(path) ? O.some(fs.readFileSync(path)) : O.none;
    const fileExists = (path: string): O.Option<string> => fs.fileExistsSync(path) ? O.some(path) : O.none;

    const resolveLib = (lib: string) =>
        pipe(
            LIB_PATH + lib,
            getSourceFile,
            O.alt(() => pipe(LIB_PATH + `lib.${lib}.d.ts`, getSourceFile)),
            E.fromOption(() => `${lib} library`)
        )

    function resolveTypes(types: string) {
        return pipe(
            // look in node_modules/@types for types package first
            `/node_modules/@types/${types}/package.json`,
            fileExists,
            // look in node_modules/ for types package if doesn't exist under @types 
            O.alt(() => pipe(`/node_modules/${types}/package.json`, fileExists)),
            O.chain(packagepath => {
                // load package.json file at packagepath, parse the JSON
                // and cast it to a JsonRecord (aka an object)
                return pipe(
                    packagepath,
                    getFile,
                    O.chain(flow(parse, O.fromEither)),
                    O.chain(O.fromPredicate(isJsonRecord)),
                    O.bindTo('$package'),
                    // look in typings and types properties for relative path
                    // to declarations file
                    O.chain(({ $package }) => pipe(
                        $package,
                        ROR_lookup('typings'),
                        O.alt(() => pipe(
                            $package,
                            ROR_lookup('types')
                        ))
                    )),
                    // cast JSON value to string
                    O.chain(O.fromPredicate(isJsonString)),
                    // resolve relative path to absolute path and load as source
                    O.map(path => posix.resolve(posix.dirname(packagepath), path)),
                    O.chain(getSourceFile)
                );
            }),
            E.fromOption(() => `${types} types`)
        );
    }

    return {
        resolveLib,
        resolveTypes
    }
}
