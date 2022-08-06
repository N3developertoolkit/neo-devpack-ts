
//https://www.growingwiththeweb.com/2020/10/typescript-readonly-typed-arrays.html

type TypedArrayMutableProperties = 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort';

export interface ReadonlyUint8ClampedArray extends Omit<Uint8ClampedArray, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyUint8Array extends Omit<Uint8Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyUint16Array extends Omit<Uint16Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyUint32Array extends Omit<Uint32Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyInt8Array extends Omit<Int8Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyInt16Array extends Omit<Int16Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyInt32Array extends Omit<Int32Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyFloat32Array extends Omit<Float32Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyFloat64Array extends Omit<Float64Array, TypedArrayMutableProperties> { readonly [n: number]: number }
export interface ReadonlyBigInt64Array extends Omit<BigInt64Array, TypedArrayMutableProperties> { readonly [n: number]: bigint }
export interface ReadonlyBigUint64Array extends Omit<BigUint64Array, TypedArrayMutableProperties> { readonly [n: number]: bigint }
