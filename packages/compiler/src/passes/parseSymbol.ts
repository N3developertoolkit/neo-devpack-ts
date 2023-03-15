import { Node, Symbol } from "ts-morph";
import { pipe } from "fp-ts/function";
import * as E from "fp-ts/Either";
import * as TS from '../utility/TS';

import { makeParseError } from "../symbolDef";
import { ParseError } from "../types/ScopeType";


export const parseSymbol = (node: Node): E.Either<ParseError, Symbol> => {
    return pipe(
        node,
        TS.getSymbol,
        E.fromOption(() => makeParseError(node)('invalid symbol'))
    );
};
