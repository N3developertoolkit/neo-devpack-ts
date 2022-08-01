export const enum StackItemType {
    Any = 0,
    Pointer = 16,
    Boolean = 32,
    Integer = 33,
    ByteString = 40,
    Buffer = 48,
    Array = 64,
    Struct = 65,
    Map = 72,
    InteropInterface = 96
}

export function toString(type: StackItemType) {
    switch(type) {
        case StackItemType.Any: return "Any";
        case StackItemType.Pointer: return "Pointer";
        case StackItemType.Boolean: return "Boolean";
        case StackItemType.Integer: return "Integer";
        case StackItemType.ByteString: return "ByteString";
        case StackItemType.Buffer: return "Buffer";
        case StackItemType.Array: return "Array";
        case StackItemType.Struct: return "Struct";
        case StackItemType.Map: return "Map";
        case StackItemType.InteropInterface: return "InteropInterface";
    }
}