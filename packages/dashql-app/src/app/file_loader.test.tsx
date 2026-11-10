import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformFile } from '../platform/file/file.js';
import type { PreparedPortableImport, SessionImportProgressConsumer } from '../session/persistence/session_import_provider.js';

const state = {
    preparePortableImport: vi.fn(),
    commitPortableImport: vi.fn(),
    navigate: vi.fn(),
    readSessionBundleFromZip: vi.fn(),
};

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { FileLoader, type FileLoaderDependencies } from './file_loader.js';

const dependencies = {
    sessionImportCard: {
        CompactNavBar: () => <></>,
    },
    readSessionBundleFromZip: state.readSessionBundleFromZip,
    useSessionImport: () => ({ preparePortableImport: state.preparePortableImport, commitPortableImport: state.commitPortableImport }),
    useRouterNavigate: () => state.navigate,
} as FileLoaderDependencies;

const BUNDLE = {
    session: {
        formatVersion: 4,
        sessionId: '11111111-2222-4333-8444-555555555555',
        name: 'Explain',
        mainDatabase: { databaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } },
        attachedDatabases: [],
        metadata: { originType: 'FILE', originalFileName: 'Explain.dashql' },
    },
    catalogs: [],
    scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }],
};

function file(readAsArrayBuffer: PlatformFile['readAsArrayBuffer'] = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))): PlatformFile {
    return {
        path: '/tmp/Explain.dashql',
        stream: () => new Blob().stream(),
        readAsArrayBuffer,
    };
}

function button(container: HTMLElement, testId: 'session-import-confirm' | 'session-import-retry' | 'session-import-replace' | 'session-import-open'): HTMLButtonElement | null {
    return container.querySelector(`[data-testid="${testId}"]`);
}

function card(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-testid="session-import-card"]');
}

/// The status of every step of the card, by step
function steps(container: HTMLElement): Record<string, string | null> {
    return Object.fromEntries([...container.querySelectorAll('[data-testid^="session-import-step-"]')]
        .map(step => [step.getAttribute('data-testid')!.slice('session-import-step-'.length), step.getAttribute('data-status')]));
}

const RESULT_BUNDLE = {
    ...BUNDLE,
    results: [
        { key: 'a'.repeat(64), bytes: new Blob([new Uint8Array(3)]) },
        { key: 'b'.repeat(64), bytes: new Blob([new Uint8Array(5)]) },
    ],
};

describe('FileLoader', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        state.preparePortableImport.mockReset().mockImplementation(async (bundle: typeof BUNDLE): Promise<PreparedPortableImport> =>
            ({ bundle: bundle as unknown as PreparedPortableImport['bundle'], conflict: null }));
        state.commitPortableImport.mockReset().mockResolvedValue('imported-session');
        state.navigate.mockReset();
        state.readSessionBundleFromZip.mockReset().mockResolvedValue(BUNDLE);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('resolves the connections of the file and waits for permission before importing', async () => {
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));

        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
        expect(state.preparePortableImport).toHaveBeenCalledWith(BUNDLE);
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', session: 'None' });
        expect(card(container)?.getAttribute('aria-busy')).toBeNull();
        expect(container.querySelector('[data-testid="session-import-summary"]')?.textContent).toContain('Explain');
        expect(container.textContent).toContain(BUNDLE.session.sessionId);
        expect(state.commitPortableImport).not.toHaveBeenCalled();

        await act(async () => button(container, 'session-import-confirm')!.click());

        await vi.waitFor(() => expect(state.commitPortableImport).toHaveBeenCalledOnce());
        expect(state.commitPortableImport).toHaveBeenCalledWith({ bundle: BUNDLE, conflict: null }, null, expect.any(Function));
        expect(state.navigate).toHaveBeenCalledOnce();
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('reads a dropped file in place', async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3])]);
        const read = vi.fn();
        await act(async () => root.render(<FileLoader file={{ ...file(read), blob }} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
        expect(state.readSessionBundleFromZip).toHaveBeenCalledWith(blob);
        expect(read).not.toHaveBeenCalled();
    });

    it('shows the stages while reading, validating and resolving', async () => {
        let finishRead!: (bytes: Uint8Array) => void;
        let finishValidation!: (bundle: typeof BUNDLE) => void;
        let finishResolving!: (prepared: PreparedPortableImport) => void;
        const read = new Promise<Uint8Array>(resolve => { finishRead = resolve; });
        state.readSessionBundleFromZip.mockReturnValue(new Promise<typeof BUNDLE>(resolve => { finishValidation = resolve; }));
        state.preparePortableImport.mockReturnValue(new Promise<PreparedPortableImport>(resolve => { finishResolving = resolve; }));

        act(() => root.render(<FileLoader file={file(() => read)} onDone={() => {}} dependencies={dependencies} />));
        const stage = () => container.querySelector('[data-testid="session-import-file-status"]')?.getAttribute('data-stage');
        expect(card(container)?.getAttribute('aria-busy')).toBe('true');
        expect(stage()).toBe('reading');
        expect(steps(container)).toEqual({ read: 'Running', check: 'None' });

        await act(async () => finishRead(new Uint8Array([1, 2, 3])));
        await vi.waitFor(() => expect(stage()).toBe('validating'));
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Running' });

        await act(async () => finishValidation(BUNDLE));
        await vi.waitFor(() => expect(stage()).toBe('resolving'));
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Running', session: 'None' });
        // The summary shows the session while its connections are resolved
        expect(container.querySelector('[data-testid="session-import-summary"]')?.textContent).toContain('Explain');

        await act(async () => finishResolving({ bundle: BUNDLE as unknown as PreparedPortableImport['bundle'], conflict: null }));
        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
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

        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(state.readSessionBundleFromZip).toHaveBeenCalledOnce();
        expect(state.commitPortableImport).not.toHaveBeenCalled();
    });

    it('shows an accessible validation error and retries', async () => {
        state.readSessionBundleFromZip.mockRejectedValueOnce(new Error('Invalid ZIP: missing dashql-session.json'));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.getAttribute('data-stage')).toBe('validating');
        expect(alert?.textContent).toContain('missing dashql-session.json');
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Failed' });

        await act(async () => button(container, 'session-import-retry')!.click());
        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('closes when the user cancels the question about the connections', async () => {
        state.preparePortableImport.mockResolvedValueOnce(null);
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));

        await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
        expect(state.commitPortableImport).not.toHaveBeenCalled();
    });

    it('marks the connections when resolving them failed', async () => {
        state.preparePortableImport.mockRejectedValueOnce(new Error('Unknown connector of the connection params with the keys [sidb]'));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')?.getAttribute('data-stage')).toBe('resolving');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('[sidb]');
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Failed', session: 'None' });
    });

    it('asks to replace or copy a registered session with the same id', async () => {
        state.preparePortableImport.mockImplementation(async (bundle: typeof BUNDLE) =>
            ({ bundle, conflict: { displayLocation: 'opfs://sessions/Explain', isNative: false } }));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));

        await vi.waitFor(() => expect(button(container, 'session-import-replace')).not.toBeNull());
        expect(button(container, 'session-import-confirm')).toBeNull();
        expect(container.querySelector('[data-testid="session-import-conflict"]')).not.toBeNull();
        expect(container.textContent).toContain('opfs://sessions/Explain');

        await act(async () => button(container, 'session-import-replace')!.click());
        await vi.waitFor(() => expect(state.commitPortableImport).toHaveBeenCalledWith(expect.anything(), 'replace', expect.any(Function)));
    });

    it('shows import failures without falsely completing the dropzone', async () => {
        const onDone = vi.fn();
        state.commitPortableImport.mockRejectedValueOnce(new Error('Storage is unavailable'));
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));
        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
        await act(async () => button(container, 'session-import-confirm')!.click());

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        expect(container.querySelector('[role="alert"]')?.getAttribute('data-stage')).toBe('importing');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('Storage is unavailable');
        // A file without query results has no step for them
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', session: 'Failed' });
        expect(onDone).not.toHaveBeenCalled();
        expect(state.navigate).not.toHaveBeenCalled();
    });

    it('shows the steps of the import as they run', async () => {
        state.readSessionBundleFromZip.mockResolvedValue(RESULT_BUNDLE);
        let report!: SessionImportProgressConsumer;
        let finish!: (sessionId: string) => void;
        state.commitPortableImport.mockImplementation((_prepared, _choice, onProgress: SessionImportProgressConsumer) => {
            report = onProgress;
            return new Promise<string>(resolve => { finish = resolve; });
        });
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));
        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', results: 'None', session: 'None' });
        expect(container.textContent).toContain('2 results, 8 bytes');

        await act(async () => button(container, 'session-import-confirm')!.click());
        expect(steps(container)).toMatchObject({ results: 'Running', session: 'None' });
        await act(async () => {
            report({ step: 'results', total: 2, outcome: { total: 2, added: 2, kept: 0, failed: 0, dropped: 0, bytes: 8, error: null } });
            report({ step: 'session' });
        });
        expect(steps(container)).toMatchObject({ results: 'Succeeded', session: 'Running' });
        expect(container.querySelector('[data-testid="session-import-step-results"]')?.textContent).toContain('2 of 2');

        await act(async () => finish('imported-session'));
        // All results are in the cache, the session opens right away
        expect(state.navigate).toHaveBeenCalledOnce();
    });

    it('keeps the card open when query results were not added', async () => {
        state.readSessionBundleFromZip.mockResolvedValue(RESULT_BUNDLE);
        state.commitPortableImport.mockImplementation(async (_prepared, _choice, onProgress: SessionImportProgressConsumer) => {
            onProgress({ step: 'results', total: 2, outcome: { total: 2, added: 1, kept: 0, failed: 1, dropped: 0, bytes: 3, error: 'The checksum of b.parquet differs' } });
            onProgress({ step: 'session' });
            return 'imported-session';
        });
        const onDone = vi.fn();
        await act(async () => root.render(<FileLoader file={file()} onDone={onDone} dependencies={dependencies} />));
        await vi.waitFor(() => expect(button(container, 'session-import-confirm')).not.toBeNull());
        await act(async () => button(container, 'session-import-confirm')!.click());

        await vi.waitFor(() => expect(button(container, 'session-import-open')).not.toBeNull());
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Succeeded', connections: 'Succeeded', results: 'Failed', session: 'Succeeded' });
        const warning = container.querySelector('[data-testid="session-import-warning"]')!;
        expect(warning.textContent).toContain('1 of 2 query results was not added to the cache (1 failed)');
        expect(warning.textContent).toContain('The checksum of b.parquet differs');
        expect(state.navigate).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();

        await act(async () => button(container, 'session-import-open')!.click());
        expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ value: 'imported-session' }));
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('marks the step of the file that failed', async () => {
        state.readSessionBundleFromZip.mockRejectedValueOnce(new Error('Invalid ZIP'));
        await act(async () => root.render(<FileLoader file={file()} onDone={() => {}} dependencies={dependencies} />));
        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        expect(steps(container)).toEqual({ read: 'Succeeded', check: 'Failed' });
    });
});
