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
vi.mock('./navbar.js', () => ({ CompactNavBar: () => null }));
vi.mock('../../ui/particle_flow/particle_flow_background.js', () => ({
    ParticleFlowBackground: () => <div data-testid="particles" />,
}));

import { FileLoader } from './file_loader.js';

const BUNDLE = {
    notebook: {
        formatVersion: 2,
        notebookId: '11111111-2222-4333-8444-555555555555',
        name: 'Explain',
        mainDatabase: { databaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } },
        attachedDatabases: [],
        metadata: { originType: 'FILE', originalFileName: 'Explain.dashql' },
    },
    schemaSql: null,
    functionsSql: null,
    scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }],
};

function file(readAsArrayBuffer: PlatformFile['readAsArrayBuffer'] = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))): PlatformFile {
    return { path: '/tmp/Explain.dashql', readAsArrayBuffer };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(container.querySelectorAll('button')).find(value => value.textContent === label)!;
}

describe('FileLoader', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        state.importPortableBundle.mockReset().mockResolvedValue('imported-notebook');
        state.navigate.mockReset();
        state.readNotebookBundleFromZip.mockReset().mockResolvedValue(BUNDLE);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('validates the file and waits for permission before importing', async () => {
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} />));

        expect(container.querySelector('[data-testid="particles"]')).not.toBeNull();
        expect(container.querySelector('h1')?.textContent).toBe('Import Notebook');
        expect(container.querySelector('section')?.getAttribute('aria-busy')).toBeNull();
        expect(container.textContent).toContain('Explain');
        expect(container.textContent).toContain('1 script');
        expect(state.importPortableBundle).not.toHaveBeenCalled();

        await act(async () => button(container, 'Import').click());

        expect(state.importPortableBundle).toHaveBeenCalledOnce();
        expect(state.navigate).toHaveBeenCalledOnce();
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('shows loading phases while reading and validating', async () => {
        let finishRead!: (bytes: Uint8Array) => void;
        let finishValidation!: (bundle: typeof BUNDLE) => void;
        const read = new Promise<Uint8Array>(resolve => { finishRead = resolve; });
        const validation = new Promise<typeof BUNDLE>(resolve => { finishValidation = resolve; });
        state.readNotebookBundleFromZip.mockReturnValue(validation);

        act(() => root.render(<FileLoader file={file(() => read)} onDone={() => {}} />));
        expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
        expect(container.textContent).toContain('Reading notebook file...');

        await act(async () => {
            finishRead(new Uint8Array([1, 2, 3]));
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Checking the notebook archive...');
        expect(container.textContent).toContain('3 bytes');

        await act(async () => finishValidation(BUNDLE));
        expect(button(container, 'Import')).not.toBeNull();
    });

    it('ignores a cancelled stale read when callbacks change', async () => {
        let finishRead!: (bytes: Uint8Array) => void;
        const read = new Promise<Uint8Array>(resolve => { finishRead = resolve; });
        const input = file(() => read);
        const onDone = vi.fn();

        act(() => root.render(<FileLoader file={input} onDone={onDone} />));
        await act(async () => {
            root.render(<FileLoader file={input} onDone={() => onDone()} />);
            finishRead(new Uint8Array([1, 2, 3]));
            await Promise.resolve();
        });

        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(state.readNotebookBundleFromZip).toHaveBeenCalledOnce();
        expect(state.importPortableBundle).not.toHaveBeenCalled();
    });

    it('shows an accessible validation error and retries', async () => {
        state.readNotebookBundleFromZip.mockRejectedValueOnce(new Error('Invalid ZIP: missing dashql-notebook.json'));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} />));

        const alert = container.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain('not a valid DashQL notebook archive');
        expect(alert?.textContent).toContain('missing dashql-notebook.json');

        await act(async () => button(container, 'Try Again').click());
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.querySelector('h1')?.textContent).toBe('Import Notebook');
    });

    it('returns to the permission screen when import is cancelled', async () => {
        state.importPortableBundle.mockResolvedValueOnce(null);
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} />));
        await act(async () => button(container, 'Import').click());

        expect(container.querySelector('h1')?.textContent).toBe('Import Notebook');
        expect(button(container, 'Import')).not.toBeNull();
    });

    it('shows import failures without falsely completing the dropzone', async () => {
        const onDone = vi.fn();
        state.importPortableBundle.mockRejectedValueOnce(new Error('Storage is unavailable'));
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} />));
        await act(async () => button(container, 'Import').click());

        expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not import this notebook');
        expect(container.textContent).toContain('Storage is unavailable');
        expect(onDone).not.toHaveBeenCalled();
        expect(state.navigate).not.toHaveBeenCalled();
    });
});
