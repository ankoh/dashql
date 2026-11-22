import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAG_TIMEOUT, FileDropzone } from './file_dropzone.js';
import { useFileDropHandler, type FileDropHandler } from './file_drop_handler.js';
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
    const showsArea = () => container.querySelector('[data-testid="file-dropzone-area"]') != null;
    const showsLoader = () => container.querySelector('[data-testid="workbook-import-card"]') != null;

    it('shows the dropzone until no drag over event follows within its timeout', () => {
        vi.useFakeTimers();
        expect(drag('dragover').defaultPrevented).toBe(true);
        // The app stays mounted under the dropzone
        expect(showsArea()).toBe(true);
        expect(showsApp()).toBe(true);

        // Another drag over event restarts the timeout
        act(() => { vi.advanceTimersByTime(DRAG_TIMEOUT - 1); });
        drag('dragover');
        act(() => { vi.advanceTimersByTime(DRAG_TIMEOUT - 1); });
        expect(showsArea()).toBe(true);
        act(() => { vi.advanceTimersByTime(1); });
        expect(showsArea()).toBe(false);
    });

    it('stops a drag at its end', () => {
        drag('dragover');
        expect(drag('dragend').defaultPrevented).toBe(true);
        expect(showsArea()).toBe(false);
    });

    it('stops a drag that drops no file', () => {
        drag('dragover');
        expect(drag('drop').defaultPrevented).toBe(true);
        expect(showsArea()).toBe(false);
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

    it('offers a drop to the handlers of the app before it loads the first file', () => {
        const takeParquet = vi.fn<FileDropHandler>(files => files.some(file => file.name.endsWith('.parquet')));
        function Workbook() {
            useFileDropHandler(takeParquet);
            return null;
        }
        act(() => root.render(<FileDropzone fileLoader={fileLoader}><div data-testid="app"><Workbook /></div></FileDropzone>));

        drag('drop', [new File(['p'], 'sales.parquet')]);
        expect(takeParquet).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ name: 'sales.parquet' })]);
        expect(showsLoader()).toBe(false);
        expect(showsApp()).toBe(true);

        // A file that no handler takes loads as a workbook
        drag('drop', [new File(['w'], 'other.dashql')]);
        expect(takeParquet).toHaveBeenCalledTimes(2);
        expect(showsLoader()).toBe(true);
    });

    it('stops listening when unmounted', () => {
        act(() => root.render(<></>));
        const event = drag('dragover');
        expect(event.defaultPrevented).toBe(false);
    });
});
