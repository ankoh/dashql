import { describe, expect, it } from 'vitest';

import { RevisionCache, share } from './projection.js';

describe('share', () => {
    it('keeps the previous objects where the next view is equal', () => {
        const prev = { a: { x: 1, list: [1, 2] }, b: { y: 'b' }, c: null as number[] | null };
        const next = { a: { x: 1, list: [1, 2] }, b: { y: 'changed' }, c: null as number[] | null };
        const shared = share(prev, next);
        expect(shared).toBe(next);
        expect(shared.a).toBe(prev.a);
        expect(shared.b).not.toBe(prev.b);
        expect(share(prev, { a: { x: 1, list: [1, 2] }, b: { y: 'b' }, c: null })).toBe(prev);
    });

    it('compares arrays by their elements and other objects by identity', () => {
        const bytes = new Uint8Array([1]);
        const prev = { list: [{ id: 1 }, { id: 2 }], bytes };
        const next = share(prev, { list: [{ id: 1 }, { id: 3 }], bytes: new Uint8Array([1]) });
        expect(next.list[0]).toBe(prev.list[0]);
        expect(next.list).not.toBe(prev.list);
        expect(next.bytes).not.toBe(bytes);
        expect(share([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
        expect(share({ a: 1 }, { b: 1 } as Record<string, number>)).toEqual({ b: 1 });
        expect(share(null, { a: 1 })).toEqual({ a: 1 });
        // Class instances and maps compare by identity
        const map = new Map([[1, 2]]);
        expect(share({ map }, { map: new Map([[1, 2]]) }).map).not.toBe(map);
    });

    it('shares the objects of another realm', () => {
        // An object without a prototype stands for the plain objects of a module in another realm
        const prev = Object.assign(Object.create(null) as Record<string, unknown>, { version: Object.assign(Object.create(null), { data: 1 }) });
        const next = Object.assign(Object.create(null) as Record<string, unknown>, { version: Object.assign(Object.create(null), { data: 1 }) });
        expect(share(prev, next)).toBe(prev);
    });
});

describe('RevisionCache', () => {
    it('builds a slice again when its revision moved and forgets slices', () => {
        const cache = new RevisionCache<number, { revision: number; prev: unknown }>();
        const first = cache.get(1, 10, prev => ({ revision: 10, prev }));
        expect(cache.get(1, 10, () => ({ revision: -1, prev: null }))).toBe(first);
        const second = cache.get(1, 11, prev => ({ revision: 11, prev }));
        expect(second.prev).toBe(first);
        cache.get(2, 1, () => ({ revision: 1, prev: null }));
        cache.delete(1);
        expect(cache.peek(1)).toBeUndefined();
        expect([...cache.keys()]).toEqual([2]);
        expect(cache.get(1, 11, prev => ({ revision: 11, prev })).prev).toBeNull();
    });
});
