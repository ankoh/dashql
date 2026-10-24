import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchSessionUrl = vi.fn();
const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
    observe() { }
    unobserve() { }
    disconnect() { }
});

import { BundledSessionsOverlay, type BundledSessionsOverlayDependencies } from './bundled_sessions_overlay.js';

const dependencies: BundledSessionsOverlayDependencies = {
    useLogger: () => ({ error: vi.fn() }),
};

describe('BundledSessionsOverlay', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        dispatchSessionUrl.mockReset();
        writeText.mockClear();
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    function sessionButton(sessionId: string, action: 'add' | 'copy'): HTMLButtonElement {
        return document.querySelector(`[data-testid="example-session"][data-session-id="${sessionId}"] [data-testid="example-session-${action}"]`) as HTMLButtonElement;
    }

    function toggle(): void {
        act(() => (container.querySelector('[data-testid="example-sessions-trigger"]') as HTMLButtonElement).click());
    }

    it('copies a public link and dispatches a bundled session URL', async () => {
        act(() => root.render(<BundledSessionsOverlay dispatchSessionUrl={dispatchSessionUrl} dependencies={dependencies} />));
        toggle();

        await act(async () => {
            sessionButton('hyper-explain', 'copy').click();
            await Promise.resolve();
        });
        expect(writeText).toHaveBeenCalledWith(
            'https://dashql.app?session=https%3A%2F%2Fdashql.app%2Fstatic%2Fexamples%2Fsessions%2Fhyper-explain%2Fdashql-session.json',
        );

        act(() => sessionButton('hyper-explain', 'add').click());
        expect(dispatchSessionUrl).toHaveBeenCalledWith(
            new URL('/static/examples/sessions/hyper-explain/dashql-session.json', globalThis.location.href).toString(),
        );
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('closes without dispatching a session', () => {
        act(() => root.render(<BundledSessionsOverlay dispatchSessionUrl={dispatchSessionUrl} dependencies={dependencies} />));
        toggle();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();

        act(() => (document.querySelector('[data-testid="example-sessions-close"]') as HTMLButtonElement).click());
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(dispatchSessionUrl).not.toHaveBeenCalled();
    });
});
