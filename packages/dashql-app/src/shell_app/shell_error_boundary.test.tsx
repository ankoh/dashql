import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { ShellErrorBoundary } from './shell_error_boundary.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function Failing(): React.ReactElement {
    throw new Error('boom');
}

describe('ShellErrorBoundary', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        // React logs what it catches
        vi.spyOn(console, 'error').mockImplementation(() => { });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it('shows the page while nothing fails', () => {
        act(() => root.render(<LoggerProvider><ShellErrorBoundary>page</ShellErrorBoundary></LoggerProvider>));
        expect(container.textContent).toContain('page');
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('says what failed and offers a reload instead of a blank page', () => {
        const reload = vi.fn();
        act(() => root.render(<LoggerProvider><ShellErrorBoundary reload={reload}><Failing /></ShellErrorBoundary></LoggerProvider>));
        const alert = container.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('boom');
        act(() => alert.querySelector('button')!.click());
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
