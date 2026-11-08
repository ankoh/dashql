import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './error_boundary.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function Failing({ error }: { error: unknown }): React.ReactElement {
    throw error;
}

describe('ErrorBoundary', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        // React logs what it catches
        vi.spyOn(console, 'error').mockImplementation(() => { });
        container = document.createElement('div');
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.restoreAllMocks();
    });

    it('renders its children if nothing fails', () => {
        const onError = vi.fn();
        act(() => root.render(<ErrorBoundary fallback={() => 'fallback'} onError={onError}>children</ErrorBoundary>));
        expect(container.textContent).toBe('children');
        expect(onError).not.toHaveBeenCalled();
    });

    it('replaces only its own children and reports the error', () => {
        const onError = vi.fn();
        const error = new Error('boom');
        act(() => root.render(
            <>
                <span>sibling</span>
                <ErrorBoundary fallback={e => `failed: ${(e as Error).message}`} onError={onError}>
                    <Failing error={error} />
                </ErrorBoundary>
            </>,
        ));
        expect(container.textContent).toBe('siblingfailed: boom');
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBe(error);
    });

    it('also catches an error that is not truthy', () => {
        act(() => root.render(
            <ErrorBoundary fallback={e => `failed: ${String(e)}`}>
                <Failing error={null} />
            </ErrorBoundary>,
        ));
        expect(container.textContent).toBe('failed: null');
    });

    it('renders the children again with a new key', () => {
        const failing = <ErrorBoundary key="a" fallback={() => 'fallback'}><Failing error={new Error('boom')} /></ErrorBoundary>;
        act(() => root.render(failing));
        expect(container.textContent).toBe('fallback');
        act(() => root.render(<ErrorBoundary key="b" fallback={() => 'fallback'}>children</ErrorBoundary>));
        expect(container.textContent).toBe('children');
    });
});
