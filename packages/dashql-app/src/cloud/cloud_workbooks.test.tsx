import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { DashQL } from '@ankoh/dashql-core';

import { WORKBOOK_TABLE } from '@ankoh/dashql-runtime/storage/workbook_tables';
import { sharedWorkbookTables } from '@ankoh/dashql-runtime/workbook/persistence/workbook_export';
import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { findLinkedWorkbook, linkedWorkbookMetadata, previewConnections, useCloudPreviewCleanup } from './cloud_workbooks.js';
import { fixedConnectionReferences } from '@ankoh/dashql-runtime/testing/mocks/connection_references';
import { testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const CLOUD_WORKBOOK = 'c0ffee00-0000-4000-8000-000000000001';
const VERSION_1 = 'c0ffee00-0000-4000-8000-000000000011';
const VERSION_2 = 'c0ffee00-0000-4000-8000-000000000012';

function workbook(workbookId: string, cloud?: { workbookId: string; versionId: string; connectionId: string; preview?: boolean }): WorkbookScripts {
    return { workbookId, workbookMetadata: cloud == null ? {} : { cloud } } as unknown as WorkbookScripts;
}

describe('Cloud workbooks', () => {
    it('finds the local workbook that shows a published workbook', () => {
        const workbooks = [
            workbook('local'),
            workbook('imported', { workbookId: CLOUD_WORKBOOK, versionId: VERSION_1, connectionId: 'cloud' }),
            workbook('preview', { workbookId: CLOUD_WORKBOOK, versionId: VERSION_2, connectionId: 'cloud', preview: true }),
        ];
        expect(findLinkedWorkbook(workbooks, CLOUD_WORKBOOK)?.workbookId).toBe('imported');
        expect(findLinkedWorkbook(workbooks, CLOUD_WORKBOOK, { preview: true })?.workbookId).toBe('preview');
        expect(findLinkedWorkbook(workbooks, CLOUD_WORKBOOK, { versionId: VERSION_1, preview: true })).toBeNull();
        expect(findLinkedWorkbook(workbooks, VERSION_1)).toBeNull();
    });

    it('links a workbook read from the cloud to its version and drops what it was linked to before', () => {
        const link = { workbookId: CLOUD_WORKBOOK, versionId: VERSION_2, connectionId: 'cloud', preview: true };
        expect(linkedWorkbookMetadata({
            originalFileName: 'hyper',
            ephemeral: true,
            cloud: { workbookId: VERSION_1, versionId: VERSION_1, connectionId: 'cloud' },
        }, link)).toEqual({ originalFileName: 'hyper', cloud: link });
    });

    it('publishes a workbook without its link', () => {
        const tables = sharedWorkbookTables({} as DashQL, {
            workbook: testWorkbook({ metadata: { originalFileName: 'hyper', cloud: { workbookId: CLOUD_WORKBOOK, versionId: VERSION_1, connectionId: 'cloud' } } }),
            catalogs: [],
            scripts: [],
        });
        expect(JSON.parse(tables[WORKBOOK_TABLE][0].metadata)).toEqual({ originalFileName: 'hyper' });
    });

    it('discards a preview once another workbook is shown', async () => {
        const discard = vi.fn(async (_workbookId: string) => {});
        const Cleanup = (props: { current: string | null; workbooks: WorkbookScripts[] }) => {
            useCloudPreviewCleanup(props.current, props.workbooks, discard);
            return null;
        };
        const container = document.createElement('div');
        const root = createRoot(container);
        const render = (current: string | null, workbooks: WorkbookScripts[]) => act(() => {
            root.render(<Cleanup current={current} workbooks={workbooks} />);
        });
        const preview = workbook('preview', { workbookId: CLOUD_WORKBOOK, versionId: VERSION_1, connectionId: 'cloud', preview: true });
        const imported = workbook('preview', { workbookId: CLOUD_WORKBOOK, versionId: VERSION_1, connectionId: 'cloud' });
        try {
            // A preview that was opened but not shown yet stays
            render('local', [workbook('local'), preview]);
            expect(discard).not.toHaveBeenCalled();
            // Shown, and a connection overview in front of it, keep it
            render('preview', [workbook('local'), preview]);
            render(null, [workbook('local'), preview]);
            expect(discard).not.toHaveBeenCalled();
            // Left for another workbook
            render('local', [workbook('local'), preview]);
            expect(discard).toHaveBeenCalledExactlyOnceWith('preview');

            // An imported preview is a local workbook and stays
            discard.mockClear();
            render('preview', [workbook('local'), imported]);
            render('local', [workbook('local'), imported]);
            expect(discard).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
        }
    });

    it('removes with a preview the connections that it registered, also after a reload', () => {
        // The preview uses the cloud, a connection of the manifest it linked to, and two that it registered, one of them
        // used by another workbook as well
        const references = fixedConnectionReferences({ preview: ['cloud', 'linked', 'own', 'shared'], other: ['shared'] });
        const kept = new Set(['cloud', 'linked']);
        expect(previewConnections('preview', references.connectionsOf('preview'), kept, references)).toEqual(['own']);
    });
});
