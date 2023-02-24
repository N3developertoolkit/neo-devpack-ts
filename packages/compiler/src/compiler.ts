import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { createDiagnostic } from "./utils";
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
// import { ContractMethod, processMethodDefinitions } from "./passes/processFunctionDeclarations";
// import { collectArtifacts } from "./collectArtifacts";
import { DebugInfoJson } from "./types/DebugInfo";
import { parseProjectSymbols, SymbolDef } from "./symbolDef";
import { LibraryDeclarations, parseProjectLibrary } from "./projectLib";
import * as ROA from 'fp-ts/ReadonlyArray'
import * as ROM from 'fp-ts/ReadonlyMap'
import * as S from 'fp-ts/State'
import * as O from 'fp-ts/Option'
import * as E from 'fp-ts/Either'
import { createSymbolMap, Scope } from "./scope";
import * as FP from 'fp-ts'
import { parseFunctionDeclarations } from "./passes/processFunctionDeclarations";
import { Operation } from "./types/Operation";
import { pipe } from "fp-ts/lib/function";
import { makeErrorObj } from "./passes/builtins";
// import { parseSourceFileDefs } from "./passes/processFunctionDeclarations";

export const DEFAULT_ADDRESS_VALUE = 53;

export class CompileError extends Error {
    constructor(
        message: string,
        public readonly node: tsm.Node
    ) {
        super(message);
    }
}

export interface CompileOptions {
    readonly addressVersion?: number;
    readonly inline?: boolean;
    readonly optimize?: boolean;
    readonly standards?: ReadonlyArray<string>;
}

export interface ContractMethod {
    name: string,
    node: tsm.FunctionDeclaration,
    operations: ReadonlyArray<Operation>,
    variables: ReadonlyArray<{ name: string, type: tsm.Type }>,
}

export interface CompileArtifacts {
    readonly diagnostics: ReadonlyArray<tsm.ts.Diagnostic>;
    readonly methods: ReadonlyArray<ContractMethod>;
    readonly nef?: sc.NEF;
    readonly manifest?: sc.ContractManifest;
    readonly debugInfo?: DebugInfoJson;
}

export interface CompileContext {
    readonly diagnostics: Array<tsm.ts.Diagnostic>;
    readonly options: Readonly<Required<CompileOptions>>;
    readonly project: tsm.Project;
    // readonly scopes: Array<ReadonlyScope>;
    // readonly methods: Array<ContractMethod>;
}

export type CompilerState<T> = S.State<ReadonlyArray<tsm.ts.Diagnostic>, T>;

const makeGlobalScope = ({ variables }: LibraryDeclarations): CompilerState<Scope> =>
    state => {

        const findVar = (name: string) => pipe(
            variables,
            ROA.findFirst(v => v.getName() === name),
            O.chain(d => pipe(d.getSymbol(), O.fromNullable))
        );

        const makeBuiltIn = (name: string) =>
            (make: (symbol: tsm.Symbol) => SymbolDef): E.Either<string, SymbolDef> => {
                return pipe(
                    name,
                    findVar,
                    O.map(make),
                    E.fromOption(() => name)
                )
            }

        let symbols: ReadonlyArray<SymbolDef> = ROA.empty;
        const $error = makeBuiltIn("Error")(makeErrorObj);
        if (E.isRight($error)) {
            symbols = ROA.append($error.right)(symbols);
        }

        // const $uint8Array = findVar('Uint8Array');


        const scope = {
            parentScope: O.none,
            symbols: createSymbolMap(symbols)
        };

        return [scope, state];
    }



export function compile(
    project: tsm.Project,
    contractName: string,
    options?: CompileOptions
): CompileArtifacts {

    // TODO: Use Pipe
    let [library, diagnostics] = parseProjectLibrary(project)(ROA.empty);
    let globalScope;
    [globalScope, diagnostics] = makeGlobalScope(library)(diagnostics);


    const q = O.of(globalScope);

    let symbolDefs;
    [symbolDefs, diagnostics] = parseProjectSymbols(project)(diagnostics);

    // let monoid = ROA.getMonoid<ContractMethod>();
    // let methods = monoid.empty;
    // for (const defs of symbolDefs) {
    //     let $methods: ReadonlyArray<ContractMethod>;
    //     [$methods, diagnostics] = parseFunctionDeclarations(globalScope)(defs)(diagnostics)
    //     methods = monoid.concat(methods, $methods);
    // }

    // for (const def of symbolDefs) {
    //     let q: any;
    //     [q, diagnostics] = parseSourceFileDefs(globalScope)(def)(diagnostics);

    // }

    // try {
    //     createSymbolTrees(context);
    //     if (hasErrors(diagnostics)) return { diagnostics, methods };
    //     processMethodDefinitions(context);
    //     if (hasErrors(diagnostics)) return { diagnostics, methods };
    //     const { nef, manifest, debugInfo } = collectArtifacts(contractName, context);
    //     if (hasErrors(diagnostics)) return { diagnostics, methods };
    //     return { nef, manifest, debugInfo, diagnostics, methods };
    // } catch (error) {
    //     diagnostics.push(toDiagnostic(error));
    // }

    // return { diagnostics, methods };
    return { diagnostics, methods: [] };
}

async function exists(rootPath: fs.PathLike) {
    try {
        await fsp.access(rootPath);
        return true;
    } catch {
        return false;
    }
}

export interface SaveArtifactsOptions {
    artifacts: CompileArtifacts;
    rootPath: string;
    baseName?: string;
    sourceDir?: string;
}

export async function saveArtifacts({ artifacts, rootPath, baseName = "contract", sourceDir }: SaveArtifactsOptions) {
    if (await exists(rootPath) === false) { await fsp.mkdir(rootPath); }

    const nefPath = path.join(rootPath, baseName + ".nef")
    const manifestPath = path.join(rootPath, baseName + ".manifest.json");
    const debugInfoPath = path.join(rootPath, baseName + ".debug.json");

    // const { nef, manifest, debugInfo } = artifacts;
    // const _nef = Buffer.from(nef.serialize(), 'hex');
    // const _manifest = JSON.stringify(manifest.toJson(), null, 4);
    // const _debugInfo = JSON.stringify(debugInfoToJson(debugInfo, nef, sourceDir), null, 4);

    // await Promise.all([
    //     fsp.writeFile(nefPath, _nef),
    //     fsp.writeFile(manifestPath, _manifest),
    //     fsp.writeFile(debugInfoPath, _debugInfo)]);
}





function parse(node: tsm.JSDocableNode) {
    for (const doc of node.getJsDocs()) {
        const st = doc.getStructure();
        var i = 0;
    }
}

function parseExtraTag() {

}

const CONTRACT_TAG = "contract";
const EXTRA_TAG = "extra";
const STANDARD_TAG = "standard";
const EVENT_TAG = "event";
const SAFE_TAG = "safe";

// TODO: finish parsing contract tags
function parseContractTag(st: tsm.JSDocStructure, options: ProcessMetadataOptions) {

    const initialTag = st.tags![0];
    if (initialTag.tagName !== CONTRACT_TAG) throw new Error(`parseContractTag ${initialTag.tagName}`);
    const contractName = st.tags![0].text;
    if (typeof contractName !== 'string' || contractName.length === 0) {
        throw new Error('contract tag must contain a non-empty string');
    }

    var length = st.tags!.length;
    for (var i = 1; i < length; i++) {
        const tag = st.tags![i];
        const d = tag.tagName;
        const q = tag.text;


    }


}

// not sure yet if I need event tags or if I can just generate these from Runtime.notify calls
function parseEventTag(st: tsm.JSDocStructure, options: ProcessMetadataOptions) {
    const initialTag = st.tags![0];
    if (initialTag.tagName !== EVENT_TAG) throw new Error(`parseEventTag ${initialTag.tagName}`);
    const eventName = st.tags![0].text;
    if (typeof eventName !== 'string' || eventName.length === 0) {
        throw new Error(`${EVENT_TAG} tag must contain a non-empty string`);
    }

    var length = st.tags!.length;
    for (var i = 1; i < length; i++) {
        const tag = st.tags![i];
        const d = tag.tagName;
        const q = tag.text;


    }


}


interface ProcessMetadataOptions {
    diagnostics: Array<tsm.ts.Diagnostic>
}

function processMetadataNode(node: tsm.JSDoc, options: ProcessMetadataOptions) {
    const st = node.getStructure();
    if (st.tags && st.tags.length > 0) {
        const tag = st.tags[0];
        switch (tag.tagName) {
            case CONTRACT_TAG:
                parseContractTag(st, options);
                break;
            case EVENT_TAG:
                parseEventTag(st, options);
                break;
            case SAFE_TAG: {
                const parent = node.getParentOrThrow();
                if (!tsm.Node.isFunctionDeclaration(parent)) {
                    options.diagnostics.push(createDiagnostic(
                        `"safe" JSDoc tag on ${parent.getKindName()} node`,
                        {
                            node,
                            category: tsm.ts.DiagnosticCategory.Warning
                        }));
                }
                break;
            }
            default:
                options.diagnostics.push(createDiagnostic(
                    `unrecognized JSDoc tag ${tag.tagName}`,
                    {
                        node,
                        category: tsm.ts.DiagnosticCategory.Warning
                    }));
                break;
        }
    }
}

function processMetadata(project: tsm.Project, options: ProcessMetadataOptions) {
    for (const src of project.getSourceFiles()) {
        if (src.isDeclarationFile()) continue;
        src.forEachChild(node => {
            if (tsm.Node.isJSDocable(node)) {
                for (const doc of node.getJsDocs()) {
                    processMetadataNode(doc, options);
                }
            }
        });
    }

}

