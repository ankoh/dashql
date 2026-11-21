import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropzone } from './file_dropzone.js';
import type { FileLoaderDependencies } from './file_loader.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const fileLoader = {
    workbookImportCard: {
        CompactNavBar: () => <></>,
    },
    useWorkbookImport: () => ({
        readImport: vi.fn(() => new Promise(() => { })),
        prepareImport: vi.fn(),
        commitImport: vi.fn(),
        dropImport: vi.fn(),
    }),
    useRouterNavigate: () => vi.fn(),
} as unknown as FileLoaderDependencies;

describe('FileDropzone', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<FileDropzone fileLoader={fileLoader}><div data-testid="app" /></FileDropzone>));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    /// Dispatch a drag event on the window, a drop carries the files
    function drag(type: string, files: File[] = []): Event {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', {
            value: { files: { length: files.length, item: (index: number) => files[index] ?? null } },
        });
        act(() => { window.dispatchEvent(event); });
        return event;
    }

    const showsApp = () => container.querySelector('[data-testid="app"]') != null;
    const showsLoader = () => container.querySelector('[data-testid="workbook-import-card"]') != null;

    it('shows the dropzone until no drag over event follows within 100 ms', () => {
        vi.useFakeTimers();
        expect(drag('dragover').defaultPrevented).toBe(true);
        expect(showsApp()).toBe(false);

        // Another drag over event restarts the timeout
        act(() => { vi.advanceTimersByTime(60); });
        drag('dragover');
        act(() => { vi.advanceTimersByTime(60); });
        expect(showsApp()).toBe(false);
        act(() => { vi.advanceTimersByTime(40); });
        expect(showsApp()).toBe(true);
    });

    it('stops a drag at its end', () => {
        drag('dragover');
        expect(drag('dragend').defaultPrevented).toBe(true);
        expect(showsApp()).toBe(true);
    });

    it('stops a drag that drops no file', () => {
        drag('dragover');
        expect(drag('drop').defaultPrevented).toBe(true);
        expect(showsApp()).toBe(true);
        expect(showsLoader()).toBe(false);
    });

    it('loads only the first dropped file and blocks other global handlers', () => {
        const other = vi.fn();
        window.addEventListener('drop', other);
        try {
            drag('dragover');
            const event = drag('drop', [new File(['first'], 'first.dashql'), new File(['second'], 'second.dashql')]);
            expect(event.defaultPrevented).toBe(true);
            expect(other).not.toHaveBeenCalled();
            expect(showsLoader()).toBe(true);
            expect(container.textContent).toContain('first.dashql');
            expect(container.textContent).not.toContain('second.dashql');
        } finally {
            window.removeEventListener('drop', other);
        }
    });

    it('stops listening when unmounted', () => {
        act(() => root.render(<></>));
        const event = drag('dragover');
        expect(event.defaultPrevented).toBe(false);
    });
});
