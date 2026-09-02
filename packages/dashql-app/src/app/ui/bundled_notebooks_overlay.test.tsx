import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchNotebookUrl = vi.fn();
const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
    observe() { }
    unobserve() { }
    disconnect() { }
});
vi.mock('../../platform/logger/logger_provider.js', () => ({
    useLogger: () => ({ error: vi.fn() }),
}));

import { BundledNotebooksOverlay } from './bundled_notebooks_overlay.js';

describe('BundledNotebooksOverlay', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        dispatchNotebookUrl.mockReset();
        writeText.mockClear();
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    it('copies a public link and dispatches a bundled notebook URL', async () => {
        act(() => root.render(<BundledNotebooksOverlay dispatchNotebookUrl={dispatchNotebookUrl} />));
        act(() => (container.querySelector('[aria-label="Example notebooks"]') as HTMLButtonElement).click());

        expect(document.querySelector('[aria-label="Add Property Graphs notebook"]')).toBeInstanceOf(HTMLButtonElement);
        expect(document.querySelector('[aria-label="Close example notebooks"]')).toBeInstanceOf(HTMLButtonElement);
        await act(async () => {
            (document.querySelector('[aria-label="Copy Explain notebook link"]') as HTMLButtonElement).click();
            await Promise.resolve();
        });
        expect(writeText).toHaveBeenCalledWith(
            'https://dashql.app?notebook=https%3A%2F%2Fdashql.app%2Fstatic%2Fexamples%2Fnotebooks%2Fhyper-explain%2Fdashql-notebook.json',
        );

        act(() => (document.querySelector('[aria-label="Add Explain notebook"]') as HTMLButtonElement).click());
        expect(dispatchNotebookUrl).toHaveBeenCalledWith(
            new URL('/static/examples/notebooks/hyper-explain/dashql-notebook.json', globalThis.location.href).toString(),
        );
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
