import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpWorkbookLoadResult } from './http_workbook_bundle.js';
import { WorkbookImportCard, type WorkbookImportCardDependencies } from './workbook_import_card.js';
import { testImportPreview } from './import_test_sources.js';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const dependencies: WorkbookImportCardDependencies = {
    CompactNavBar: () => <></>,
};

const RESULT: HttpWorkbookLoadResult = {
    preview: testImportPreview({
        formatVersion: 11,
        workbookId: '11111111-2222-4333-8444-555555555555',
        name: 'Flat workbook',
        connections: [{ connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } as ConnectionParams }],
        scripts: [{ name: '01_query.sql', connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
        attachments: [],
        metadata: { originType: 'HTTP', originalHttpUrl: 'https://example.com/dashql-workbook.json' },
    }),
    listedScriptCount: 1,
    loadedScriptCount: 1,
    incomplete: false,
};

describe('WorkbookImportCard V2 ready state', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('summarizes flat scripts and starts import', () => {
        const onImport = vi.fn();
        act(() => root.render(<WorkbookImportCard phase="ready" result={RESULT} conflictLocation={null}
            conflictIsNative={false} busy={false} onImport={onImport} onReplace={() => {}}
            onCreateNew={() => {}} onClose={() => {}} dependencies={dependencies} />));
        expect(container.textContent).toContain('Flat workbook');
        expect(container.querySelector('[data-testid="workbook-import-incomplete"]')).toBeNull();
        expect(container.querySelector('[data-testid="workbook-import-conflict"]')).toBeNull();
        const button = container.querySelector('[data-testid="workbook-import-confirm"]') as HTMLButtonElement;
        act(() => button.click());
        expect(onImport).toHaveBeenCalledOnce();
    });

    it('surfaces incomplete index state and native replacement safety', () => {
        act(() => root.render(<WorkbookImportCard phase="ready" result={{ ...RESULT, listedScriptCount: 3, incomplete: true }}
            conflictLocation="/tmp/native" conflictIsNative busy={false} onImport={() => {}} onReplace={() => {}}
            onCreateNew={() => {}} onClose={() => {}} dependencies={dependencies} />));
        expect(container.querySelector('[data-testid="workbook-import-incomplete"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="workbook-import-conflict"]')?.hasAttribute('data-native')).toBe(true);
        expect(container.textContent).toContain('/tmp/native');
        expect(container.querySelector('[data-testid="workbook-import-confirm"]')).toBeNull();
        expect(container.querySelector('[data-testid="workbook-import-replace"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="workbook-import-create-new"]')).not.toBeNull();
    });
});
