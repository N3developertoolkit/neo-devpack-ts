import { expect } from 'chai';
import 'mocha';
import { SyntaxKind } from 'ts-morph';
import { testCompileNode } from './testCompileNode';
import { parseExpression, ParseResult } from '../src/passes/expressionParser';

describe('parseExpression', () => {

    function testInitializer(name: string, source: string, expected: ParseResult) {
        it(name, () => {
            const decl = testCompileNode(source, SyntaxKind.VariableDeclaration);
            const result = parseExpression(decl.getInitializerOrThrow());
            expect(result).to.deep.equal(expected);
        })
    }

    const tests: [string, string, ParseResult][] = [
        ["true literal", "const foo = true", true],
        ["false literal", "const foo = false", false],
        ["numeric literal", "const foo = 42", 42n],
        ["bigint literal", "const foo = 42n", 42n],
        // ["array literal", "const foo = [1,2,3,4,5]", 42n],
        // ["array literal as const", "const foo = [1,2,3,4,5] as const", Buffer.from([1,2,3,4,5])],
        ["string literal", "const foo = 'hello'", Buffer.from("68656C6C6F", "hex")],
        ["true literal as const", "const foo = true as const", true],
        ["numeric literal as const", "const foo = 42 as const", 42n],
        ["bigint literal as const", "const foo = 42n as const", 42n],
        ["string literal as const", "const foo = 'hello' as const", Buffer.from("68656C6C6F", "hex")],

        // ["true literal as const", "const foo = true as const", true],
        // ["true literal as boolean", "const foo = true as boolean", true],
        // ["true literal as bigint", "const foo = true as bigint", true],
        // ["false as const literal", "const foo = false as const", false],
        // ["numeric as const literal", "const foo = 42 as const", 42n],
        // ["bigint as const literal", "const foo = 42n as const", 42n],
        // ["string as const literal", "const foo = 'hello' as const", Buffer.from("68656C6C6F", "hex")],
    ]

    tests.forEach(v => testInitializer(v[0], v[1], v[2]));
});
