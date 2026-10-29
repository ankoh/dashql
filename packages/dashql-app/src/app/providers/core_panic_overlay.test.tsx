import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_RESTART_CTX } from '../../platform/crosstab/app_hand_over.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { CorePanicOverlay } from './core_panic_overlay.js';
import type { CorePanicListener } from '@ankoh/dashql-core';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('CorePanicOverlay', () => {
    let root: Root | null = null;
    let container: HTMLDivElement | null = null;
    afterEach(() => {
        act(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
    });

    it('asks for a restart after a panic of the core', async () => {
        const listeners = new Set<CorePanicListener>();
        const subscribe = (listener: CorePanicListener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        };
        const restart = vi.fn(async () => { });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root!.render(
                <LoggerProvider>
                    <APP_RESTART_CTX.Provider value={restart}>
                        <CorePanicOverlay subscribe={subscribe} />
                    </APP_RESTART_CTX.Provider>
                </LoggerProvider>,
            );
        });
        expect(container.querySelector('[data-testid="core-panic"]')).toBeNull();

        await act(async () => { for (const listener of listeners) listener('index out of bounds'); });
        expect(container.querySelector('[data-testid="core-panic"]')?.textContent).toContain('index out of bounds');
        await act(async () => { container!.querySelector<HTMLButtonElement>('[data-testid="core-panic-reload"]')!.click(); });
        expect(restart).toHaveBeenCalledTimes(1);
    });
});
