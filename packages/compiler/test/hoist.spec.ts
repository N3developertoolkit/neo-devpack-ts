import 'mocha';
import { expect } from 'chai';
import * as tsm from "ts-morph";
import * as E from 'fp-ts/Either';
import { createTestProject, expectEither, expectResults, createLiteralCTO, createVarDeclCTO } from './testUtils.spec';
import { hoistFunctionDecl, hoistInterfaceDecl } from '../src/passes/hoistDeclarations';
import { pipe } from 'fp-ts/lib/function';
import { GetOpsFunc } from '../src/types/CompileTimeObject';
import { CompileTimeObject } from '../src/types/CompileTimeObject';
import { ParseError, makeParseError } from '../src/utils';
import { pushInt, pushString } from '../src/types/Operation';


function makeGetValueFunc(value: CompileTimeObject | ParseError): GetOpsFunc {
    return ('message' in value)
        ? () => E.left(value)
        : () => E.right(value.loadOps);
}

function expectCall(node: tsm.CallExpression, cto: CompileTimeObject, $this: CompileTimeObject | ParseError | undefined, ...args: (CompileTimeObject | ParseError)[]) {
    if (!cto.call) expect.fail("cto.call is undefined");
    const $thisGV = $this ? makeGetValueFunc($this) : makeGetValueFunc(makeParseError()("invalid $this"));
    const argsGV = args.map(makeGetValueFunc);
    return pipe(
        cto.call(node)($thisGV, argsGV),
        E.match(
            err => expect.fail(err.message),
            value => value
        )
    );
}

describe("hoist declarations", () => {
    describe("function declarations", () => {
        it("normal function", () => {
            const contract = /*javascript*/ `
                function updateBalance(account: ByteString, amount: bigint): boolean { return true; }
                const account: ByteString = null!;
                updateBalance(account, 100n);`;
            const { sourceFile } = createTestProject(contract);

            const updateDecl = sourceFile.getFunctionOrThrow("updateBalance");
            const update = pipe(updateDecl, hoistFunctionDecl, expectEither);

            expect(update.node).equals(updateDecl);
            expect(update.symbol).equals(updateDecl.getSymbolOrThrow());
            expect(update.loadOps).empty;

            const expr = sourceFile.getStatementByKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpression()
                .asKindOrThrow(tsm.SyntaxKind.CallExpression);
            const account = createVarDeclCTO(sourceFile, 'account');
            const amount = createLiteralCTO(expr.getArguments()[1], 100n);

            const callResult = expectCall(expr, update, undefined, account, amount);
            expectResults(callResult.loadOps,
                amount.loadOp,
                account.loadOp,
                { kind: 'call', method: update.symbol });
        });

        it("@event function", () => {
            const contract = /*javascript*/ `
                /** @event */
                declare function Transfer(from: ByteString | null, to: ByteString | null, amount: bigint): void;
                
                const from: ByteString = null!;
                const to: ByteString = null!;
                Transfer(from, to, 100n);`;

            const { sourceFile } = createTestProject(contract);

            const transferDecl = sourceFile.getFunctionOrThrow("Transfer");
            const transfer = pipe(transferDecl, hoistFunctionDecl, expectEither)

            expect(transfer.node).equals(transferDecl);
            expect(transfer.symbol).equals(transferDecl.getSymbolOrThrow());
            expect(transfer.loadOps).empty;

            const expr = sourceFile.getStatementByKindOrThrow(tsm.SyntaxKind.ExpressionStatement)
                .getExpression()
                .asKindOrThrow(tsm.SyntaxKind.CallExpression);
            const from = createVarDeclCTO(sourceFile, 'from');
            const to = createVarDeclCTO(sourceFile, 'to');
            const amount = createLiteralCTO(expr.getArguments()[2], 100n);

            const callResult = expectCall(expr, transfer, undefined, from, to, amount);
            expectResults(callResult.loadOps,
                amount.loadOp,
                to.loadOp,
                from.loadOp,
                pushInt(3n),
                { kind: "packarray" },
                pushString("Transfer"),
                { kind: 'syscall', name: "System.Runtime.Notify" });
        });
    })

    it("interface declaration", () => {
        const contract = /*javascript*/ `interface TokenState { owner: ByteString; name: string; description: string; image: string; }`;
        const { sourceFile } = createTestProject(contract);
        const tokenState = sourceFile.getInterfaceOrThrow("TokenState");

        const result = pipe(tokenState, hoistInterfaceDecl, expectEither);
        expect(result.type).equals(tokenState.getType());
        expect(result.properties).length(4);

        // TODO: validate properties
    })

//     describe("variable declaration", () => {
//         it("simple identifier", () => {
//             const contract = /*javascript*/ `const test = 100n;`

//             const { sourceFile } = createTestProject(contract);
//             const varStmt = sourceFile.getVariableStatements()[0];

//             const test = sourceFile.getVariableDeclarationOrThrow("test");
//             const testName = test.getNameNode();

//             const result = pipe(varStmt, hoistVariableStmt, expectEither);

//             const kind = tsm.VariableDeclarationKind.Const;
//             expect(result).length(1);
//             expect(result[0]).deep.equals({ node: testName, symbol: testName.getSymbolOrThrow(), type: test.getType(), kind });
//         })
        
//         function mapBindingElement(kind: tsm.VariableDeclarationKind)  {
//             return (element: tsm.BindingElement) => {
//                 const node = element.getNameNode().asKindOrThrow(tsm.SyntaxKind.Identifier);
//                 const symbol= element.getSymbolOrThrow();
//                 const type = node.getType();

//                 return { node, symbol, type, kind };
//             }
//         }

//         it("array binding pattern", () => {
//             const contract = /*javascript*/ `const [test1,test2,,test3] = [1,2,3,4];`

//             const { sourceFile } = createTestProject(contract);
//             const varStmt = sourceFile.getVariableStatements()[0];

//             const expected = varStmt.getDeclarations()[0].getNameNode()
//                 .asKindOrThrow(tsm.SyntaxKind.ArrayBindingPattern)
//                 .getElements()
//                 .filter(tsm.Node.isBindingElement)
//                 .map(mapBindingElement(tsm.VariableDeclarationKind.Const));

//             const actual = pipe(varStmt, hoistVariableStmt, expectEither);
//             expect(actual).deep.equals(expected);
//         })

//         it("object binding pattern", () => {
//             const contract = /*javascript*/ `const v = {a:1, b:2, c:3, d:4}; const { a, b:z, d} = v;`;
//             const { sourceFile } = createTestProject(contract);
//             const varStmt = sourceFile.getVariableStatements()[1];

//             const expected = varStmt.getDeclarations()[0].getNameNode()
//                 .asKindOrThrow(tsm.SyntaxKind.ObjectBindingPattern)
//                 .getElements()
//                 .map(mapBindingElement(tsm.VariableDeclarationKind.Const));

//             const actual = pipe(varStmt, hoistVariableStmt, expectEither);
//             expect(actual).deep.equals(expected);
//         });
//     });
})