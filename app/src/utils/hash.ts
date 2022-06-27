import { DataType } from 'apache-arrow/type';
import { Type } from 'apache-arrow/enum';
import { Vector } from 'apache-arrow/vector';

/// Simple 53-bit hasher
export function cyrb53(str: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/// Hash an arrow column
export function hashArrowColumn<R extends DataType<Type, any>>(col: Vector<R> | null): number {
    if (col == null) return 0;
    let hash = 0;
    for (const v of col) {
        hash = cyrb53(v.toString(), hash);
    }
    return hash;
}
