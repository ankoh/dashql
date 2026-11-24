import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePendingRequest, type PendingRequest } from './use_pending_request.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('usePendingRequest', () => {
    let container: HTMLDivElement;
    let root: Root;
    let mounted: boolean;
    let handle: PendingRequest<string, number | null>;

    const Harness = () => {
        handle = usePendingRequest<string, number | null>('test', null);
        return <div data-testid="pending">{handle.pending?.args ?? ''}</div>;
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<Harness />));
        mounted = true;
    });

    afterEach(() => {
        if (mounted) act(() => root.unmount());
        container.remove();
    });

    function request(args: string, signal?: AbortSignal): Promise<number | null> {
        let result!: Promise<number | null>;
        act(() => { result = handle.request(args, signal); });
        return result;
    }
    function shown(): string {
        return container.textContent ?? '';
    }

    it('shows the arguments until the request resolves', async () => {
        const result = request('first');
        expect(shown()).toBe('first');
        let resolved = false;
        act(() => { resolved = handle.resolve(42); });
        expect(resolved).toBe(true);
        await expect(result).resolves.toBe(42);
        expect(shown()).toBe('');
        expect(handle.resolve(1)).toBe(false);
    });

    it('settles a dismissed request with the dismissed result', async () => {
        const result = request('first');
        act(() => handle.dismiss());
        await expect(result).resolves.toBeNull();
        expect(shown()).toBe('');
    });

    it('rejects a second request without disturbing the pending one', async () => {
        const first = request('first');
        await expect(request('second')).rejects.toThrow('A test request is already pending.');
        expect(shown()).toBe('first');
        act(() => { handle.resolve(1); });
        await expect(first).resolves.toBe(1);
        // The next request starts once the first settled
        const next = request('next');
        expect(shown()).toBe('next');
        act(() => handle.dismiss());
        await expect(next).resolves.toBeNull();
    });

    it('dismisses on abort and stops listening once settled', async () => {
        const abort = new AbortController();
        const aborted = request('first', abort.signal);
        expect(handle.pending?.signal).toBe(abort.signal);
        act(() => abort.abort());
        await expect(aborted).resolves.toBeNull();
        expect(shown()).toBe('');

        const later = new AbortController();
        const removeListener = vi.spyOn(later.signal, 'removeEventListener');
        const resolved = request('second', later.signal);
        act(() => { handle.resolve(2); });
        await expect(resolved).resolves.toBe(2);
        expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('settles an aborted request right away without showing it', async () => {
        await expect(request('first', AbortSignal.abort())).resolves.toBeNull();
        expect(shown()).toBe('');
        expect(handle.pending).toBeNull();
    });

    it('keeps the request pending when a render brings a new dismissed result', async () => {
        let objectHandle!: PendingRequest<string, { dismissed: boolean }>;
        const ObjectHarness = () => {
            objectHandle = usePendingRequest<string, { dismissed: boolean }>('object', { dismissed: true });
            return <div>{objectHandle.pending?.args ?? ''}</div>;
        };
        act(() => root.render(<ObjectHarness />));
        let result!: Promise<{ dismissed: boolean }>;
        act(() => { result = objectHandle.request('first'); });
        expect(shown()).toBe('first');
        act(() => { objectHandle.resolve({ dismissed: false }); });
        await expect(result).resolves.toEqual({ dismissed: false });
    });

    it('dismisses the pending request on unmount', async () => {
        const result = request('first');
        act(() => root.unmount());
        mounted = false;
        await expect(result).resolves.toBeNull();
    });
});
