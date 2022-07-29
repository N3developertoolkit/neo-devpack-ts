export type ImmutableCollection<T> = T extends Array<infer I> 
    ? ReadonlyArray<I>
    : T extends Map<infer K, infer V> 
        ? ReadonlyMap<K, V>
        : T extends Set<infer I>
            ? ReadonlySet<I>
            : T; 

export type Immutable<T> = {
    readonly [P in keyof T]: ImmutableCollection<T[P]>;
};
