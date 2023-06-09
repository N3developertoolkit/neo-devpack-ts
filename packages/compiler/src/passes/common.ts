import { CompileTimeObject } from "../types/CompileTimeObject";

export type CompileTimeObjectWithIndex = {
    cto: CompileTimeObject;
    index: readonly (string | number)[];
};

export interface NamedCompileTimeObjectWithIndex extends CompileTimeObjectWithIndex {
    name: string;
}
