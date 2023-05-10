import 'mocha';


import { parseExpression } from '../src/passes/expressionProcessor';
import { parse } from 'path';
import { createTestProject, createTestGlobalScope } from './testUtils.spec';
// export function createTestScope(symbols?: CompileTimeObject | readonly CompileTimeObject[], types?: CompileTimeObject | readonly CompileTimeObject[]) {
//     return pipe(
//         updateScope(createEmptyScope())(symbols, types),
//         E_fail
//     );
// }

// export function findSymbol(name: string, node: tsm.Node, flags: tsm.ts.SymbolFlags) {
//     const symbol = node.getSymbolsInScope(flags).find(s => s.getName() === name);
//     if (!symbol) expect.fail(`Symbol ${name} not found`);
//     return symbol;
// }

// export function findProperty(name: string, symbol: tsm.Symbol) {
//     const props = symbol.getDeclarations().flatMap(d => d.getType().getProperties());
//     const prop = props.find(p => p.getName() === name);
//     if (!prop) expect.fail(`Property ${name} not found`);
//     return prop;
// }

// export function E_fail<T>(value: E.Either<string | ParseError, T>): T {
//     if (E.isLeft(value)) {
//         const message = typeof value.left  === 'string' ? value.left : value.left.message;
//         expect.fail(message);
//     } else {
//         return value.right;
//     }
// }

// describe("built-ins", () => {
//     it("@stackItem", () => {
//         const contract = /*javascript*/`
//             function testFunc() {
//                 const tx = Runtime.scriptContainer as Transaction;
//                 const currentHash = tx.sender;
//             }`;

//             const { sourceFile } = createTestProject(contract);
//             const symbolTXtype = findSymbol("Transaction", sourceFile, tsm.ts.SymbolFlags.Interface);
//             const declTXtype = symbolTXtype.getDeclarations()[0].asKindOrThrow(tsm.SyntaxKind.InterfaceDeclaration);
//             const ctoTXtype = makeStackItemType(declTXtype);

//             const func = sourceFile.getFunctionOrThrow('testFunc');
//             const symbolTX = findSymbol("tx", func, tsm.ts.SymbolFlags.Variable);
//             const decltx = symbolTX.getValueDeclarationOrThrow();
//             const ctoTX = makeCompileTimeObject(decltx, symbolTX, { loadOps: [{ kind: 'noop', debug: 'tx' } as Operation] });

//             const scope = createTestScope(ctoTX, ctoTXtype);

//             const decl = func.getDescendantsOfKind(tsm.SyntaxKind.VariableDeclaration)[1];
//             const init = decl.getInitializerOrThrow();

//             const tree = parseExpressionTree(init);
//             const resolved = pipe(
//                 tree,
//                 E.chain(loadTree(scope)),
//                 E.match(error => expect.fail(error.message), identity)
//             )

//     })
// });

describe("builts-ins", () => {
    describe("ByteString", () => {
        it("fromHex", () => {
            const contract = /*javascript*/`const VALUE_KEY = ByteString.fromHex("0x00");`;
            const { project, sourceFile } = createTestProject(contract);
            const scope = createTestGlobalScope(project);

            const decl = sourceFile.getVariableDeclarationOrThrow('VALUE_KEY');
            const init = decl.getInitializerOrThrow();

            const q = parseExpression(scope)(init);

        })
    })
});

