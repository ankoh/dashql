import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformFile } from '../../platform/file/file.js';

const state = vi.hoisted(() => ({
    importPortableBundle: vi.fn(),
    navigate: vi.fn(),
    readNotebookBundleFromZip: vi.fn(),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../router/router.js', () => ({
    OPEN_LINK_NOTEBOOK: Symbol('OPEN_LINK_NOTEBOOK'),
    useRouterNavigate: () => state.navigate,
}));
vi.mock('../notebook/persistence/notebook_import.js', () => ({
    readNotebookBundleFromZip: state.readNotebookBundleFromZip,
}));
vi.mock('../notebook/persistence/notebook_import_provider.js', () => ({
    useNotebookImport: () => ({ importPortableBundle: state.importPortableBundle }),
}));

import { FileLoader } from './file_loader.js';

describe('FileLoader', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        state.importPortableBundle.mockReset().mockResolvedValue('imported-notebook');
        state.navigate.mockReset();
        state.readNotebookBundleFromZip.mockReset().mockResolvedValue({ notebook: {} });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('restarts with a fresh abort signal when an import dependency changes', async () => {
        let finishFirstRead: ((bytes: Uint8Array) => void) | null = null;
        const firstRead = new Promise<Uint8Array>(resolve => { finishFirstRead = resolve; });
        const file: PlatformFile = {
            path: 'notebook.dashql',
            readAsArrayBuffer: vi.fn()
                .mockReturnValueOnce(firstRead)
                .mockResolvedValue(new Uint8Array([1, 2, 3])),
        };
        const onDone = vi.fn();

        act(() => root.render(<FileLoader file={file} onDone={onDone} />));
        state.importPortableBundle = vi.fn().mockResolvedValue('imported-notebook');
        await act(async () => {
            root.render(<FileLoader file={file} onDone={onDone} />);
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Notebook imported successfully');
        expect(state.importPortableBundle).toHaveBeenCalledOnce();
        expect(onDone).toHaveBeenCalledOnce();

        await act(async () => {
            finishFirstRead!(new Uint8Array([1, 2, 3]));
            await Promise.resolve();
        });
        expect(container.textContent).not.toContain('signal is aborted without reason');
    });
});
