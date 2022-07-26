import { sc } from "@cityofzion/neon-core";
import * as tsm from "ts-morph";
import { getPrefix, isPushDataOpCode, isTargetOpCode, isTryOpCode, OpCodeAnnotations } from "./opCodeAnnotations";

export interface OffsetTarget {
    instruction?: Instruction
}
export interface Instruction {
    opCode: sc.OpCode;
    operand?: Uint8Array;
    target?: OffsetTarget;
    finallyTarget?: OffsetTarget;
}

export interface SourceReferenceSetter {
    readonly instruction: Instruction | undefined;
    set(node?: tsm.Node): void;
}

function isNode(input: Instruction | tsm.Node): input is tsm.Node {
    return input instanceof tsm.Node;
}

function isInstruction(input: Instruction | tsm.Node): input is Instruction {
    return !isNode(input);
}

export function separateInstructions(
    items?: ReadonlyArray<Instruction | tsm.Node>
) : [ReadonlyArray<Instruction>, ReadonlyMap<number, tsm.Node>] {
    if (!items) return [[], new Map()];

    const instructions = items.filter(isInstruction);
    const references = new Map(iterateRefs(instructions));

    return [instructions, references];

    function *iterateRefs(instructions: ReadonlyArray<Instruction | tsm.Node>): IterableIterator<[number, tsm.Node]> {
        if (!items) throw new Error();

        const length = items.length;
        for (let i = 0; i < length; i++) {
            const item = items[i];
            if (isNode(item)) {
                const next = items[i + 1];
                if (next && isInstruction(next)) {
                    const index = instructions.indexOf(next);
                    if (index >= 0) {
                        yield [ index, item ];
                    }
                }
            }
        }
    }
}

export function combineInstructions(
    instructions: ReadonlyArray<Instruction>,
    references: ReadonlyMap<number, tsm.Node>
): Array<Instruction | tsm.Node> {
    const items: Array<Instruction | tsm.Node> = [...instructions];
    const entries = [...references.entries()].sort((a, b) => b[0] - a[0]);
    for (const [index, node] of entries) {
        items.splice(index, 0, node);
    }
    return items;
}

export class ScriptBuilder {
    private readonly _items = new Array<Instruction | tsm.Node>();

    get instructions() { return this._items; }

    // script builder stores instructions and sources references in a single array
    // to make it easy to insert operations at the head of the array (like INITSLOT)
    // without having to modify reference indexes. getScript separates the instructions
    // and source references into separate collections for later use in the compilation pipeline
    
    // TODO: would it make more sense to return a single collection and leave the separation step
    //       for later in the pipeline?
    getScript(): {
        instructions: ReadonlyArray<Instruction>,
        sourceReferences: ReadonlyMap<number, tsm.Node>
    } {
        const [instructions,  references] = separateInstructions(this._items);
        
        return {
            instructions,
            sourceReferences: references
        }
    }

    getRefSetter(): { set(node?: tsm.Node): void } {
        const length = this._items.length;
        return {
            set: (node?) => {
                if (node && length < this._items.length) {
                    this._items.splice(length, 0, node);
                }
            }
        }
    }

    emitInitSlot(localCount: number, paramCount: number) {
        if (localCount > 0 || paramCount > 0) {
            this._items.unshift({
                opCode: sc.OpCode.INITSLOT, 
                operand: Uint8Array.from([localCount, paramCount])
            });
        }
    }

    pushTarget(opCode: sc.OpCode, target: OffsetTarget, finallyTarget?: OffsetTarget): SourceReferenceSetter {
        return this.pushHelper({ opCode, target, finallyTarget });
    }

    push(instruction: Instruction): SourceReferenceSetter;
    push(opCode: sc.OpCode): SourceReferenceSetter;
    push(opCode: sc.OpCode, operand: ArrayLike<number>): SourceReferenceSetter;
    push(arg1: Instruction | sc.OpCode, arg2?: ArrayLike<number>): SourceReferenceSetter {
        if (typeof arg1 === 'object') {
            if (arg2) { throw new Error("Invalid second argument"); }
            return this.pushHelper(arg1);
        } else {
            const operand = arg2
                ? arg2 instanceof Uint8Array
                    ? arg2
                    : Uint8Array.from(arg2)
                : undefined;
            return this.pushHelper({ opCode: arg1, operand });
        }
    }

    private pushHelper(ins: Instruction): SourceReferenceSetter {
        // validate instruction 
        const { opCode, operand, target, finallyTarget} = ins;
        switch (true) {
            case isTryOpCode(opCode): 
                if (!target || !finallyTarget) throw new Error(`Invalid targets for ${sc.OpCode[opCode]}`);
                break;
            case isTargetOpCode(opCode):
                if (!target) throw new Error(`Invalid target for ${sc.OpCode[opCode]}`);
                break;
            case isPushDataOpCode(opCode): {
                if (!operand) throw new Error(`Invalid PUSHDATA operand`);
                const { operandSizePrefix } = OpCodeAnnotations[opCode];
                if (!operandSizePrefix) throw new Error(`Missing operandSizePrefix for ${sc.OpCode[opCode]}`)
                const prefix = getPrefix(operandSizePrefix, operand);
                if (operand.length !== operandSizePrefix + prefix) {
                    throw new Error(`Invalid ${sc.OpCode[opCode]} operand. Expected ${prefix + operandSizePrefix}, received ${operand.length}`);
                }
                break;
            }
            default: {
                const { operandSize } = OpCodeAnnotations[opCode];
                if (operandSize) {
                    if (!operand) throw new Error(`Missing ${sc.OpCode[opCode]} operand`);
                    if (operand.length !== operandSize) throw new Error(`Invalid ${sc.OpCode[opCode]} operand. Expected ${operandSize}, received ${operand.length}`);
                }
            }
        }

        const index = this._items.push(ins) - 1;
        return {
            instruction: ins,
            set: (node?) => {
                if (node) { this._items.splice(index, 0, node); }
            }
        }
    }
}
