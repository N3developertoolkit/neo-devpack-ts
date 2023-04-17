import { Node, Symbol } from "ts-morph";
import { pipe } from "fp-ts/function";
import * as E from "fp-ts/Either";
import * as TS from '../TS';
import { ParseError, makeParseError } from "../utils";

export const parseSymbol = (node: Node): E.Either<ParseError, Symbol> => {
    return pipe(
        node,
        TS.getSymbol,
        E.fromOption(() => makeParseError(node)('invalid symbol'))
    );
};
