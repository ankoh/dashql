import { describe, expect, it, vi } from 'vitest';

import { Store } from '@ankoh/dashql-runtime/store/store';

describe('store', () => {
    it('runs every updater exactly once and notifies after changes', () => {
        const store = new Store(1);
        const listener = vi.fn();
        store.subscribe(listener);
        const updater = vi.fn((value: number) => value + 1);
        store.update(updater);
        expect(updater).toHaveBeenCalledOnce();
        expect(store.current).toBe(2);
        expect(listener).toHaveBeenCalledOnce();
        store.update(value => value);
        expect(listener).toHaveBeenCalledOnce();
    });
});
