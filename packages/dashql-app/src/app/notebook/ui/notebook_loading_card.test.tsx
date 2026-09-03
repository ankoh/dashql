import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotebookBundle } from '../persistence/notebook_bundle.js';
import { NotebookImportCard } from './notebook_import_card.js';

const FILE_BUNDLE: NotebookBundle = {
    notebook: {
        formatVersion: 2,
        notebookId: '11111111-2222-4333-8444-555555555555',
        name: 'Local notebook',
        mainDatabase: {
            databaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            params: {
                hyper: {
                    protocol: 'WASM',
                    endpoint: '',
                    tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
                },
            },
        },
        attachedDatabases: [],
        metadata: { originType: 'FILE', originalFileName: 'local.dashql' },
    },
    schemaSql: null,
    functionsSql: null,
    scripts: [{ name: 'query.sql', sql: 'SELECT 1' }],
};

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
    observe() { }
    unobserve() { }
    disconnect() { }
});
vi.mock('../../ui/navbar.js', () => ({ CompactNavBar: () => null }));
vi.mock('../../../ui/particle_flow/particle_flow_background.js', () => ({ ParticleFlowBackground: () => null }));

describe('NotebookImportCard loading state', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const render = (card: React.ReactElement) => root.render(<MemoryRouter>{card}</MemoryRouter>);

    it('shows indeterminate manifest loading and cancels', () => {
        const onCancel = vi.fn();
        act(() => render(
            <NotebookImportCard
                phase="loading"
                sourceUrl="https://example.com/dashql-notebook.json"
                progress={{ phase: 'manifest' }}
                onClose={onCancel}
            />,
        ));

        expect(container.querySelector('h1')?.textContent).toBe('Loading Notebook');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading notebook manifest');
        expect(container.querySelector('[role="progressbar"]')).toBeNull();
        expect(container.textContent).toContain('https://example.com/dashql-notebook.json');

        const cancel = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
        act(() => cancel.click());
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('shows determinate file and script progress after discovery', () => {
        act(() => render(
            <NotebookImportCard
                phase="loading"
                sourceUrl="https://example.com/dashql-notebook.json"
                progress={{
                    phase: 'files',
                    notebookName: 'Example',
                    notebookId: '4f741f53-d76f-4a6d-b1d8-c22aa85bd449',
                    completedFileCount: 5,
                    totalFileCount: 9,
                    completedScriptCount: 2,
                    totalScriptCount: 4,
                }}
                onClose={() => { }}
            />,
        ));

        expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading scripts: 2 of 4');
        const progress = container.querySelector('[role="progressbar"]')!;
        expect(progress.getAttribute('aria-valuenow')).toBe('56');
        expect(progress.getAttribute('aria-valuetext')).toBe('5 of 9 files');
        expect(container.textContent).toContain('Example');
        expect(container.textContent).toContain('4f741f53-d76f-4a6d-b1d8-c22aa85bd449');
    });

    it('uses the shared card for local-file permission and errors', () => {
        const onImport = vi.fn();
        act(() => render(
            <NotebookImportCard phase="file-ready" sourcePath="/tmp/local.dashql" fileByteCount={1200}
                bundle={FILE_BUNDLE} busy={false} onImport={onImport} onClose={() => {}} />,
        ));
        expect(container.querySelector('h1')?.textContent).toBe('Import Notebook');
        expect(container.textContent).toContain('Local notebook');
        const importButton = Array.from(container.querySelectorAll('button')).find(value => value.textContent === 'Import')!;
        act(() => importButton.click());
        expect(onImport).toHaveBeenCalledOnce();

        act(() => render(
            <NotebookImportCard phase="file-error" sourcePath="/tmp/local.dashql" fileByteCount={1200}
                failedStage="validating" errorMessage="Invalid ZIP" onRetry={() => {}} onClose={() => {}} />,
        ));
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('not a valid DashQL notebook archive');
        expect(container.textContent).toContain('Invalid ZIP');
    });
});
