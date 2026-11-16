import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as core from '@akohn/dashql';

import type { PlatformFile } from '../platform/file/file.js';
import type { PreparedImport, WorkbookCommitOptions } from '../workbook/persistence/workbook_import_provider.js';

const state = {
    readImport: vi.fn(),
    prepareImport: vi.fn(),
    commitImport: vi.fn(),
    dropImport: vi.fn(),
    navigate: vi.fn(),
};

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { FileLoader, type FileLoaderDependencies } from './file_loader.js';

const dependencies = {
    workbookImportCard: {
        CompactNavBar: () => <></>,
    },
    useWorkbookImport: () => ({
        readImport: state.readImport,
        prepareImport: state.prepareImport,
        commitImport: state.commitImport,
        dropImport: state.dropImport,
    }),
    useRouterNavigate: () => state.navigate,
} as FileLoaderDependencies;

const PREVIEW: core.ImportPreview = {
    importId: 1,
    workbook: {
        formatVersion: 11,
        workbookId: '11111111-2222-4333-8444-555555555555',
        name: 'Explain',
        connections: [{ connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } }],
        scripts: [{ name: '01_query.sql', connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
        attachments: [],
        metadata: { originType: 'FILE', originalFileName: 'Explain.dashql' },
    },
    scriptCount: 1,
    attachmentCount: 0,
    results: { count: 0, bytes: 0 },
    conflict: null,
    questions: [],
    invalidCatalogs: [],
    filesValid: true,
    nativePath: null,
};

/// A prepared import of a preview
function prepared(preview: core.ImportPreview, conflict: PreparedImport['conflict'] = null): PreparedImport {
    return { preview, connections: {}, unasked: false, conflict };
}

function file(readAsArrayBuffer: PlatformFile['readAsArrayBuffer'] = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))): PlatformFile {
    return {
        path: '/tmp/Explain.dashql',
        stream: () => new Blob().stream(),
        readAsArrayBuffer,
    };
}

function button(container: HTMLElement, testId: 'workbook-import-confirm' | 'workbook-import-retry' | 'workbook-import-replace' | 'workbook-import-open'): HTMLButtonElement | null {
    return container.querySelector(`[data-testid="${testId}"]`);
}

function card(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-testid="workbook-import-card"]');
}

/// The status of every step of the card, by step
function steps(container: HTMLElement): Record<string, string | null> {
    return Object.fromEntries([...container.querySelectorAll('[data-testid^="workbook-import-step-"]')]
        .map(step => [step.getAttribute('data-testid')!.slice('workbook-import-step-'.length), step.getAttribute('data-status')]));
}

const RESULT_PREVIEW: core.ImportPreview = { ...PREVIEW, results: { count: 2, bytes: 8 } };

describe('FileLoader', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        state.prepareImport.mockReset().mockImplementation(async (preview: core.ImportPreview) => prepared(preview));
        state.commitImport.mockReset().mockResolvedValue('imported-workbook');
        state.dropImport.mockReset();
        state.navigate.mockReset();
        state.readImport.mockReset().mockResolvedValue(PREVIEW);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('resolves the connections of the file and waits for permission before importing', async () => {
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));

        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        expect(state.prepareImport).toHaveBeenCalledWith(PREVIEW);
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', workbook: 'None' });
        expect(card(container)?.getAttribute('aria-busy')).toBeNull();
        expect(container.querySelector('[data-testid="workbook-import-summary"]')?.textContent).toContain('Explain');
        expect(container.textContent).toContain('11111111-2222-4333-8444-555555555555');
        expect(state.commitImport).not.toHaveBeenCalled();

        await act(async () => button(container, 'workbook-import-confirm')!.click());

        await vi.waitFor(() => expect(state.commitImport).toHaveBeenCalledOnce());
        expect(state.commitImport).toHaveBeenCalledWith(prepared(PREVIEW), null, { onProgress: expect.any(Function) });
        expect(state.navigate).toHaveBeenCalledOnce();
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('reads a dropped file in place', async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3])]);
        const read = vi.fn();
        await act(async () => root.render(<FileLoader file={{ ...file(read), blob }} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        expect(state.readImport).toHaveBeenCalledWith({ archive: blob });
        expect(read).not.toHaveBeenCalled();
    });

    it('shows the stages while reading, validating and resolving', async () => {
        let finishRead!: (bytes: Uint8Array) => void;
        let finishValidation!: (preview: core.ImportPreview) => void;
        let finishResolving!: (prepared: PreparedImport) => void;
        const read = new Promise<Uint8Array>(resolve => { finishRead = resolve; });
        state.readImport.mockReturnValue(new Promise<core.ImportPreview>(resolve => { finishValidation = resolve; }));
        state.prepareImport.mockReturnValue(new Promise<PreparedImport>(resolve => { finishResolving = resolve; }));

        act(() => root.render(<FileLoader file={file(() => read)} onDone={() => {}} dependencies={dependencies} />));
        const stage = () => container.querySelector('[data-testid="workbook-import-file-status"]')?.getAttribute('data-stage');
        expect(card(container)?.getAttribute('aria-busy')).toBe('true');
        expect(stage()).toBe('reading');
        expect(steps(container)).toEqual({ read: 'Running', check: 'None' });

        await act(async () => finishRead(new Uint8Array([1, 2, 3])));
        await vi.waitFor(() => expect(stage()).toBe('validating'));
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Running' });

        await act(async () => finishValidation(PREVIEW));
        await vi.waitFor(() => expect(stage()).toBe('resolving'));
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Running', workbook: 'None' });
        // The summary shows the workbook while its connections are resolved
        expect(container.querySelector('[data-testid="workbook-import-summary"]')?.textContent).toContain('Explain');

        await act(async () => finishResolving(prepared(PREVIEW)));
        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
    });

    it('ignores a cancelled stale read when callbacks change', async () => {
        let finishRead!: (bytes: Uint8Array) => void;
        const read = new Promise<Uint8Array>(resolve => { finishRead = resolve; });
        const input = file(() => read);
        const onDone = vi.fn();

        act(() => root.render(<FileLoader file={input} onDone={onDone} dependencies={dependencies} />));
        await act(async () => {
            root.render(<FileLoader file={input} onDone={() => onDone()} dependencies={dependencies} />);
            finishRead(new Uint8Array([1, 2, 3]));
        });

        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(state.readImport).toHaveBeenCalledOnce();
        expect(state.commitImport).not.toHaveBeenCalled();
    });

    it('shows an accessible validation error and retries', async () => {
        state.readImport.mockRejectedValueOnce(new Error('Invalid ZIP: missing dashql-workbook.json'));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.getAttribute('data-stage')).toBe('validating');
        expect(alert?.textContent).toContain('missing dashql-workbook.json');
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Failed' });

        await act(async () => button(container, 'workbook-import-retry')!.click());
        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('closes when the user cancels the question about the connections', async () => {
        state.prepareImport.mockResolvedValueOnce(null);
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));

        await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
        expect(state.commitImport).not.toHaveBeenCalled();
    });

    it('lets go of the import when the user closes the card', async () => {
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));
        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click());

        await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
        expect(state.dropImport).toHaveBeenCalledWith(PREVIEW);
        expect(state.commitImport).not.toHaveBeenCalled();
    });

    it('marks the connections when resolving them failed', async () => {
        state.prepareImport.mockRejectedValueOnce(new Error('Unknown connector of the connection params with the keys [sidb]'));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')?.getAttribute('data-stage')).toBe('resolving');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('[sidb]');
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Failed', workbook: 'None' });
    });

    it('asks to replace or copy a registered workbook with the same id', async () => {
        state.prepareImport.mockImplementation(async (preview: core.ImportPreview) =>
            prepared(preview, { workbookId: 'Explain', displayLocation: 'opfs://workbooks/Explain', isNative: false }));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(button(container, 'workbook-import-replace')).not.toBeNull());
        expect(button(container, 'workbook-import-confirm')).toBeNull();
        expect(container.querySelector('[data-testid="workbook-import-conflict"]')).not.toBeNull();
        expect(container.textContent).toContain('opfs://workbooks/Explain');

        await act(async () => button(container, 'workbook-import-replace')!.click());
        await vi.waitFor(() => expect(state.commitImport).toHaveBeenCalledWith(expect.anything(), 'replace', { onProgress: expect.any(Function) }));
    });

    it('shows import failures without falsely completing the dropzone', async () => {
        const onDone = vi.fn();
        state.commitImport.mockRejectedValueOnce(new Error('Storage is unavailable'));
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));
        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        await act(async () => button(container, 'workbook-import-confirm')!.click());

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')?.getAttribute('data-stage')).toBe('importing');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('Storage is unavailable');
        // A file without query results has no step for them
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', workbook: 'Failed' });
        expect(onDone).not.toHaveBeenCalled();
        expect(state.navigate).not.toHaveBeenCalled();
    });

    it('shows the steps of the import as they run', async () => {
        state.readImport.mockResolvedValue(RESULT_PREVIEW);
        let report!: NonNullable<WorkbookCommitOptions['onProgress']>;
        let finish!: (workbookId: string) => void;
        state.commitImport.mockImplementation((_prepared, _choice, options: WorkbookCommitOptions) => {
            report = options.onProgress!;
            return new Promise<string>(resolve => { finish = resolve; });
        });
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));
        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', results: 'None', workbook: 'None' });
        expect(container.textContent).toContain('2 results, 8 bytes');

        await act(async () => button(container, 'workbook-import-confirm')!.click());
        expect(steps(container)).toMatchObject({ results: 'Running', workbook: 'None' });
        await act(async () => {
            report({ step: 'results', total: 2, outcome: { total: 2, added: 2, kept: 0, failed: 0, dropped: 0, bytes: 8, error: null } });
            report({ step: 'workbook' });
        });
        expect(steps(container)).toMatchObject({ results: 'Succeeded', workbook: 'Running' });
        expect(container.querySelector('[data-testid="workbook-import-step-results"]')?.textContent).toContain('2 of 2');

        await act(async () => finish('imported-workbook'));
        // All results are in the cache, the workbook opens right away
        expect(state.navigate).toHaveBeenCalledOnce();
    });

    it('keeps the card open when query results were not added', async () => {
        state.readImport.mockResolvedValue(RESULT_PREVIEW);
        state.commitImport.mockImplementation(async (_prepared, _choice, options: WorkbookCommitOptions) => {
            options.onProgress!({ step: 'results', total: 2, outcome: { total: 2, added: 1, kept: 0, failed: 1, dropped: 0, bytes: 3, error: 'The checksum of b.parquet differs' } });
            options.onProgress!({ step: 'workbook' });
            return 'imported-workbook';
        });
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));
        await vi.waitFor(() => expect(button(container, 'workbook-import-confirm')).not.toBeNull());
        await act(async () => button(container, 'workbook-import-confirm')!.click());

        await vi.waitFor(() => expect(button(container, 'workbook-import-open')).not.toBeNull());
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', results: 'Failed', workbook: 'Succeeded' });
        const warning = container.querySelector('[data-testid="workbook-import-warning"]')!;
        expect(warning.textContent).toContain('1 of 2 query results was not added to the cache (1 failed)');
        expect(warning.textContent).toContain('The checksum of b.parquet differs');
        expect(state.navigate).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();

        await act(async () => button(container, 'workbook-import-open')!.click());
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: 'imported-workbook' }));
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('marks the step of the file that failed', async () => {
        state.readImport.mockRejectedValueOnce(new Error('Invalid ZIP'));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));
        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Failed' });
    });
});
