import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { collectArtifacts } from "./collectArtifacts";
import { processFunctionDeclarationsPass } from "./passes/processFunctionDeclarations";
import { createGlobalScope, Scope } from "./scope";
import { Operation } from "./types";
import { DebugInfo, toJson as debugInfoToJson } from "./types/DebugInfo";
import { toDiagnostic } from "./utils";
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { LocalVariable } from "./types/FunctionBuilder";

// https://github.com/CityOfZion/neon-js/issues/858
const DEFAULT_ADDRESS_VALUE = 53;

export class CompileError extends Error {
    constructor(
        message: string,
        public readonly node: tsm.Node
    ) {
        super(message);
    }
}

export interface CompileOptions {
    readonly project: tsm.Project;
    readonly addressVersion?: number;
    readonly inline?: boolean;
    readonly optimize?: boolean;
}

export interface FunctionContext {
    readonly node: tsm.FunctionDeclaration;
    operations?: ReadonlyArray<Operation>;
    locals?: ReadonlyArray<LocalVariable>;
}

export interface CompileArtifacts {
    nef: sc.NEF;
    manifest: sc.ContractManifest;
    debugInfo: DebugInfo;
}

export interface CompileContext {
    readonly diagnostics: Array<tsm.ts.Diagnostic>;
    readonly globals: Scope;
    readonly options: Readonly<Required<Omit<CompileOptions, 'project'>>>;
    readonly project: tsm.Project;
    readonly functions: Array<FunctionContext>;
}

export function compile(options: CompileOptions) {

    const globals = createGlobalScope(options.project);
    const context: CompileContext = {
        diagnostics: [],
        globals,
        options: {
            addressVersion: options.addressVersion ?? DEFAULT_ADDRESS_VALUE,
            inline: options.inline ?? false,
            optimize: options.optimize ?? false,
        },
        project: options.project,
        functions: []
    };

    // type CompilePass = (context: CompileContext) => void;
    const passes = [
        processFunctionDeclarationsPass,
    ] as const;

    for (const pass of passes) {
        try {
            pass(context);
        } catch (error) {
            context.diagnostics.push(toDiagnostic(error));
        }

        if (context.diagnostics.some(d => d.category == tsm.ts.DiagnosticCategory.Error)) {
            break;
        }
    }

    let artifacts: CompileArtifacts | undefined; 
    try {
        artifacts = collectArtifacts(context);
    } catch (error) {
        context.diagnostics.push(toDiagnostic(error));
    }

    return {
        diagnostics: context.diagnostics,
        artifacts,
        context
    };
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

    const {nef, manifest, debugInfo} = artifacts;
    const _nef = Buffer.from(nef.serialize(), 'hex');
    const _manifest = JSON.stringify(manifest.toJson(), null, 4);
    const _debugInfo = JSON.stringify(debugInfoToJson(debugInfo, nef, sourceDir), null, 4);

    await Promise.all([
        fsp.writeFile(nefPath, _nef), 
        fsp.writeFile(manifestPath, _manifest),
        fsp.writeFile(debugInfoPath, _debugInfo)]);
}