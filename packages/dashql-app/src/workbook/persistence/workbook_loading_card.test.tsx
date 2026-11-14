import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkbookBundle } from '@ankoh/dashql-runtime/storage/workbook_bundle';
import { WorkbookImportCard, type WorkbookImportCardDependencies } from './workbook_import_card.js';

const FILE_BUNDLE: WorkbookBundle = {
    workbook: {
        formatVersion: 11,
        workbookId: '11111111-2222-4333-8444-555555555555',
        name: 'Local workbook',
        connections: [{
            connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            params: {
                hyper: {
                    protocol: 'WASM',
                    endpoint: '',
                    tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
                },
            },
        }],
        scripts: [],
        attachments: [],
        metadata: { originType: 'FILE', originalFileName: 'local.dashql' },
    },
    catalogs: [],
    scripts: [{ name: 'query.sql', sql: 'SELECT 1' }],
};

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const dependencies: WorkbookImportCardDependencies = {
    CompactNavBar: () => <></>,
};

describe('WorkbookImportCard loading state', () => {
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
            <WorkbookImportCard
                phase="loading"
                sourceUrl="https://example.com/dashql-workbook.json"
                progress={{ phase: 'manifest' }}
                onClose={onCancel}
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[role="status"]')).not.toBeNull();
        expect(container.querySelector('[role="progressbar"]')).toBeNull();
        expect(container.textContent).toContain('https://example.com/dashql-workbook.json');

        const cancel = container.querySelector('[data-testid="dialog-close"]') as HTMLButtonElement;
        act(() => cancel.click());
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('shows determinate file and script progress after discovery', () => {
        act(() => render(
            <WorkbookImportCard
                phase="loading"
                sourceUrl="https://example.com/dashql-workbook.json"
                progress={{
                    phase: 'files',
                    workbookName: 'Example',
                    workbookId: '4f741f53-d76f-4a6d-b1d8-c22aa85bd449',
                    completedFileCount: 5,
                    totalFileCount: 9,
                    completedScriptCount: 2,
                    totalScriptCount: 4,
                }}
                onClose={() => { }}
                dependencies={dependencies}
            />,
        ));

        const progress = container.querySelector('[role="progressbar"]')!;
        expect(progress.getAttribute('aria-valuenow')).toBe('56');
        expect(container.textContent).toContain('Example');
        expect(container.textContent).toContain('4f741f53-d76f-4a6d-b1d8-c22aa85bd449');
    });

    it('uses the shared card for local-file permission and errors', () => {
        const onImport = vi.fn();
        const onRetry = vi.fn();
        act(() => render(
            <WorkbookImportCard phase="file-ready" sourcePath="/tmp/local.dashql" fileByteCount={1200}
                bundle={FILE_BUNDLE} steps={[]} conflict={null} busy={false} onImport={onImport} onReplace={() => {}} onCreateNew={() => {}} onClose={() => {}} dependencies={dependencies} />,
        ));
        expect(container.textContent).toContain('Local workbook');
        const importButton = container.querySelector('[data-testid="workbook-import-confirm"]') as HTMLButtonElement;
        act(() => importButton.click());
        expect(onImport).toHaveBeenCalledOnce();

        act(() => render(
            <WorkbookImportCard phase="file-error" sourcePath="/tmp/local.dashql" fileByteCount={1200} steps={[]} bundle={null}
                failedStage="validating" errorMessage="Invalid ZIP" onRetry={onRetry} onClose={() => {}} dependencies={dependencies} />,
        ));
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.getAttribute('data-stage')).toBe('validating');
        expect(alert?.textContent).toContain('Invalid ZIP');
        expect(container.querySelector('[data-testid="workbook-import-confirm"]')).toBeNull();
        act(() => (container.querySelector('[data-testid="workbook-import-retry"]') as HTMLButtonElement).click());
        expect(onRetry).toHaveBeenCalledOnce();
    });
});
