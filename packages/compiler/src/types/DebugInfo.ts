import { ContractType } from "./ContractType";
import * as tsm from "ts-morph";

export interface DebugMethodInfo {
    isPublic: boolean,
    name: string,
    range: { start: number, end: number }
    parameters?: Array<DebugSlotVariable>,
    variables?: Array<DebugSlotVariable>,
    returnType?: ContractType,
    sequencePoints: Map<number, tsm.Node>,
}

export interface DebugSlotVariable {
    name: string;
    type: ContractType;
    index?: number;
}
