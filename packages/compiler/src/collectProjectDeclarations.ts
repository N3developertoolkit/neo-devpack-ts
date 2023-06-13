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

import { CompileError, createDiagnostic } from "./utils";
import { LibraryDeclaration } from "./types/LibraryDeclaration";

function isJsonRecord(json: JSON.Json): json is JSON.JsonRecord {
    return json !== null && typeof json === 'object' && !(json instanceof Array);
}

function isJsonString(json: JSON.Json): json is string {
    return typeof json === 'string';
}

const collectDeclarations =
    (resolver: SourceFileResolver) =>
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
                        const decl = child as tsm.ModuleDeclaration;
                        // Ignore namespaces in declaration files. Neo.d.ts doesn't use them and 
                        // none of the namespaces from the standard TS lib files are supported. 
                        if (!decl.hasNamespaceKeyword()) {
                            const body = decl.getBody();
                            const modDecls = body ? collectDeclarations(resolver)(body) : [];
                            declarations = ROA.concat(modDecls)(declarations);
                        }
                        break;
                    }
                    case tsm.SyntaxKind.ExportDeclaration: {
                        // The only export declarations we expect to see is the empty one in neo.d.ts.
                        // None of the standard TS lib files have an export declaration.
                        const exports = (child as tsm.ExportDeclaration).getNamedExports();
                        if (ROA.isNonEmpty(exports)) throw new CompileError('non empty ExportDeclaration', child)
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
    (resolver: SourceFileResolver) =>
        (src: tsm.SourceFile): S.State<readonly LibraryDeclaration[], readonly E.Either<string, tsm.SourceFile>[]> =>
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
                    resolveSourceFiles(resolver)(libs, types),
                    ROA.concat($declarations)(declarations)
                ];
            }

export const collectProjectDeclarations =
    (project: tsm.Project): S.State<readonly tsm.ts.Diagnostic[], readonly LibraryDeclaration[]> =>
        diagnostics => {
            const srcResolver = makeSourceFileResolver(project);
            const $parseLibrarySourceFile = collectSourceFileDeclarations(srcResolver);

            const opts = project.compilerOptions.get();
            let { left: failures, right: sources } = pipe(
                opts,
                opts => resolveSourceFiles(srcResolver)(opts.lib ?? [], opts.types ?? []),
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

interface SourceFileResolver {
    resolveLib(lib: string): E.Either<string, tsm.SourceFile>,
    resolveTypes(types: string): E.Either<string, tsm.SourceFile>,
}

function resolveSourceFiles(resolver: SourceFileResolver) {
    return (libs: readonly string[], types: readonly string[]) => {
        const resolvedLibs = pipe(libs, ROA.map(resolver.resolveLib));
        const resolvedTypes = pipe(types, ROA.map(resolver.resolveTypes));
        return ROA.concat(resolvedLibs)(resolvedTypes);
    };
}

function makeSourceFileResolver(project: tsm.Project): SourceFileResolver {

    const fs = project.getFileSystem();
    const getSourceFile = (path: string) => pipe(project.getSourceFile(path), O.fromNullable);
    const getFile = (path: string) => fs.fileExistsSync(path) ? O.some(fs.readFileSync(path)) : O.none;
    const fileExists = (path: string): O.Option<string> => fs.fileExistsSync(path) ? O.some(path) : O.none;

    const LIB_PATH = `/node_modules/typescript/lib/`;
    const resolveLib = (lib: string) => pipe(
        // First, try and resolve lib as a full file name
        LIB_PATH + lib,
        getSourceFile,
        // If that fails, try and resolve lib as a library name by adding 
        // the "lib." prefix and the ".d.ts" extension
        O.alt(() => pipe(LIB_PATH + `lib.${lib}.d.ts`, getSourceFile)),
        // if neither resolution approach works, return an error
        E.fromOption(() => `${lib} library`)
    );

    const resolveTypes = (types: string) => pipe(
        // First, look in node_modules/@types for types package
        `/node_modules/@types/${types}/package.json`,
        fileExists,
        // if types package doesn't exist under @types, look in node_modules/  
        O.alt(() => pipe(`/node_modules/${types}/package.json`, fileExists)),
        // resolve the type information from resolved types package.json to a source file
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
            // resolve relative path to absolute path and load as source file
            O.map(path => posix.resolve(posix.dirname(pkgJsonPath), path)),
            O.chain(getSourceFile)
        )),
        // if types package cannot be found or loaded, return an error
        E.fromOption(() => `${types} types`)
    );

    return { resolveLib, resolveTypes };
}
