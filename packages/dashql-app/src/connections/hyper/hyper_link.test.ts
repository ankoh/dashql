import { describe, expect, it, vi } from 'vitest';

import { readHyperLinkTabState, HyperLinkTabStore } from './hyper_link.js';
import type { KeyValueStorage } from '@akohn/dashql/platform/key_value_storage';

describe('the Hyper links of a tab', () => {
    it('reads the links of the tab, also from broken or refused storage', () => {
        const storage = (value: string | null, refuse = false) => ({
            getItem: () => { if (refuse) throw new DOMException('denied', 'SecurityError'); return value; },
        }) as unknown as KeyValueStorage;
        expect(readHyperLinkTabState(storage(JSON.stringify({ tokens: { a: 'secret', b: 1 }, current: 'a' }))))
            .toEqual({ tokens: { a: 'secret' }, current: 'a' });
        expect(readHyperLinkTabState(storage('not json'))).toEqual({ tokens: {}, current: null });
        expect(readHyperLinkTabState(storage(null, true))).toEqual({ tokens: {}, current: null });
        expect(readHyperLinkTabState(null)).toEqual({ tokens: {}, current: null });
    });

    it('keeps the token of a link in the storage of the tab and tells its subscribers', () => {
        const items = new Map<string, string>();
        const storage: KeyValueStorage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } };
        const store = new HyperLinkTabStore(storage);
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        store.setToken('a', 'secret');
        expect(store.get()).toEqual({ tokens: { a: 'secret' }, current: 'a' });
        expect(listener).toHaveBeenCalledOnce();
        // A reload reads the links again
        expect(new HyperLinkTabStore(storage).get()).toEqual({ tokens: { a: 'secret' }, current: 'a' });
        unsubscribe();
        store.setToken('b', 'other');
        expect(listener).toHaveBeenCalledOnce();
        // Without storage the links last until the reload
        const refused = new HyperLinkTabStore({ getItem: () => null, setItem: () => { throw new DOMException('denied', 'QuotaExceededError'); } });
        refused.setToken('a', 'secret');
        expect(refused.get().current).toBe('a');
    });
});
