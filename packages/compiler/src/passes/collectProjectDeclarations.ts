import { posix } from 'path';

import * as tsm from "ts-morph";

import { flow, identity, pipe } from 'fp-ts/function';
import * as ROA from 'fp-ts/ReadonlyArray';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import * as S from 'fp-ts/State';
import * as ROS from 'fp-ts/ReadonlySet';
import * as JSON from "fp-ts/Json";
import * as ROR from 'fp-ts/ReadonlyRecord';
import * as STR from 'fp-ts/string';

import { CompileError, createDiagnostic } from "../utils";
import { CompilerState } from "../types/CompileOptions";
import { LibraryDeclaration } from "../types/LibraryDeclaration";

function isJsonRecord(json: JSON.Json): json is JSON.JsonRecord {
    return json !== null && typeof json === 'object' && !(json instanceof Array);
}

function isJsonString(json: JSON.Json): json is string {
    return typeof json === 'string';
}

const collectDeclarations =
    (resolver: Resolver) =>
        (node: tsm.Node): readonly LibraryDeclaration[] => {

            let declarations: readonly LibraryDeclaration[] = ROA.empty;

            node.forEachChild(child => {
                switch (child.getKind()) {
                    case tsm.SyntaxKind.EnumDeclaration:
                        declarations = ROA.append<LibraryDeclaration>(child as tsm.EnumDeclaration)(declarations);
                        break;
                    case tsm.SyntaxKind.FunctionDeclaration:
                        declarations = ROA.append<LibraryDeclaration>(child as tsm.FunctionDeclaration)(declarations);
                        break;
                    case tsm.SyntaxKind.InterfaceDeclaration:
                        declarations = ROA.append<LibraryDeclaration>(child as tsm.InterfaceDeclaration)(declarations);
                        break;
                    case tsm.SyntaxKind.TypeAliasDeclaration:
                        declarations = ROA.append<LibraryDeclaration>(child as tsm.TypeAliasDeclaration)(declarations);
                        break;
                    case tsm.SyntaxKind.VariableStatement: {
                        const varDecls = (child as tsm.VariableStatement).getDeclarations();
                        declarations = ROA.concat<LibraryDeclaration>(varDecls)(declarations);
                        break;
                    }
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
                        throw new CompileError(`collectDeclarations ${child.getKindName()}`, child)
                }
            })

            return declarations;
        }

const collectSourceFileDeclarations =
    (resolver: Resolver) =>
        (src: tsm.SourceFile): S.State<readonly LibraryDeclaration[], ReadonlyArray<E.Either<string, tsm.SourceFile>>> =>
            declarations => {

                const getFileReferenceName = (file: tsm.FileReference) => file.getFileName()
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
            let parsed: ReadonlySet<string> = ROS.empty;
            let declarations: readonly LibraryDeclaration[] = ROA.empty;

            while (ROA.isNonEmpty(sources)) {
                pipe(
                    sources,
                    RNEA.matchLeft((head, tail) => {
                        sources = tail;
                        const headPath = head.getFilePath();
                        if (ROS.elem(STR.Eq)(headPath)(parsed)) return;
                        parsed = ROS.insert(STR.Eq)(headPath)(parsed);

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

    const resolveTypes = (types: string) =>
        pipe(
            // look in node_modules/@types for types package first
            `/node_modules/@types/${types}/package.json`,
            fileExists,
            // look in node_modules/ for types package if doesn't exist under @types 
            O.alt(() => pipe(`/node_modules/${types}/package.json`, fileExists)),
            O.chain(pkgJsonPath => pipe(
                pkgJsonPath,
                // load package.json file, parse the JSON and cast it to a JsonRecord (aka an object)
                getFile,
                O.chain(flow(JSON.parse, O.fromEither)),
                O.chain(O.fromPredicate(isJsonRecord)),
                // look in typings and types properties for relative path
                // to declarations file
                O.chain(pkgJson => pipe(
                    pkgJson,
                    ROR.lookup('typings'),
                    O.alt(() => pipe(
                        pkgJson,
                        ROR.lookup('types')
                    ))
                )),
                // cast JSON value to string
                O.chain(O.fromPredicate(isJsonString)),
                // resolve relative path to absolute path and load as source
                O.map(path => posix.resolve(posix.dirname(pkgJsonPath), path)),
                O.chain(getSourceFile)
            )),
            E.fromOption(() => `${types} types`)
        )

    return {
        resolveLib,
        resolveTypes
    }
}
