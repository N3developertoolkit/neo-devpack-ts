import * as tsm from "ts-morph";

export type LibraryDeclaration =
    tsm.EnumDeclaration |
    tsm.FunctionDeclaration |
    tsm.InterfaceDeclaration |
    tsm.TypeAliasDeclaration |
    tsm.VariableDeclaration;
