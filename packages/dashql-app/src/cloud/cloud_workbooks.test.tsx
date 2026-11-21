import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { VERSIONS_TABLE } from '@akohn/dashql/platform/storage/workbook_tables';
import { createTestRuntime } from '@akohn/dashql/runtime/testing/test_runtime';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { findLinkedWorkbook, linkedWorkbookMetadata, previewConnections, useCloudPreviewCleanup } from './cloud_workbooks.js';
import { TEST_WORKBOOK_ID, testWorkbook, WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const CLOUD_WORKBOOK = 'c0ffee00-0000-4000-8000-000000000001';
const VERSION_1 = 'c0ffee00-0000-4000-8000-000000000011';
const VERSION_2 = 'c0ffee00-0000-4000-8000-000000000012';

function workbook(workbookId: string, cloud?: { workbookId: string; versionId: string; connectionId: string; preview?: boolean }): WorkbookScripts {
    return {
        workbookId,
        workbookMetadata: cloud == null ? {} : { cloud },
        cloud: cloud == null ? null : { workbookId: cloud.workbookId, versionId: cloud.versionId, preview: cloud.preview === true },
    } as unknown as WorkbookScripts;
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

    it('publishes a workbook without its link', async () => {
        // The runtime reads the workbook from the storage and sanitizes the shared workbook
        const storage = new WorkbookTestBackend();
        await storage.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            metadata: { originalFileName: 'hyper', cloud: { workbookId: CLOUD_WORKBOOK, versionId: VERSION_1, connectionId: 'cloud' } },
        }));
        const runtime = await createTestRuntime({ storage });
        try {
            const exported: { metadata: string | null } = { metadata: null };
            await runtime.exportTables(TEST_WORKBOOK_ID, { withCatalog: true, withLoginHint: false }, async tables => {
                exported.metadata = tables[VERSIONS_TABLE][0].metadata;
            });
            expect(JSON.parse(exported.metadata!)).toEqual({ originalFileName: 'hyper' });
        } finally {
            await runtime.destroy();
        }
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
        const workbooks = new Map([['preview', ['cloud', 'linked', 'own', 'shared']], ['other', ['shared']]]);
        const workbooksOf = (connectionId: string) => [...workbooks].filter(([, connectionIds]) => connectionIds.includes(connectionId)).map(([workbookId]) => workbookId);
        const kept = new Set(['cloud', 'linked']);
        expect(previewConnections('preview', workbooks.get('preview')!, kept, workbooksOf)).toEqual(['own']);
    });
});
