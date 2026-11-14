// The registry of the workbooks of the runtime (WorkbookScriptsRegistryService): what its actions do to a workbook, the
// promotion of the ephemeral workbook and the previews of published workbooks. The hooks of the app stay in the app.
import { describe, expect, it, vi } from 'vitest';

import { StorageWriter, WRITE_WORKBOOK_PROPERTIES } from '../../storage/storage_writer.js';
import { TASK_UPDATE_SCHEDULER } from '../../store/store.js';
import { TestLogger } from '../../testing/test_logger.js';
import { WorkbookTestBackend } from '../../testing/workbook_test_backend.js';
import { isCloudPreview, isEphemeralWorkbook, REGISTER_QUERY, RENAME_WORKBOOK, REORDER_SCRIPTS, SET_WORKBOOK_CLOUD_LINK, type WorkbookScripts, type WorkbookScriptsAction } from './workbook_scripts.js';
import { WorkbookScriptsRegistryService } from './workbook_scripts_registry_service.js';

/// Run a step of a test and wait for it
const step = async (run: () => unknown) => { await run(); };

function fixture(workbookId: string): WorkbookScripts {
    // REGISTER_QUERY only needs the script entry; no Wasm or execution setup is required.
    return {
        workbookId,
        pendingConnection: null,
        scripts: { 1: { scriptKey: 1, fileName: '1.sql', latestQueryId: null, connection: { connectionId: `${workbookId}-database` } } },
        scriptRefs: { '1.sql': { scriptId: 1, fileName: '1.sql' } },
        scriptOrder: ['1.sql'],
    } as unknown as WorkbookScripts;
}

/// The registry with workbooks, the actions on one of them and the registry as it is now
function createRegistry(workbooks: WorkbookScripts[], workbookId: string) {
    const logger = new TestLogger();
    const service = new WorkbookScriptsRegistryService({ logger, storageWriter: new StorageWriter(logger, new WorkbookTestBackend()) }, TASK_UPDATE_SCHEDULER);
    service.store.update(registry => ({ ...registry, workbookScriptsMap: new Map(workbooks.map(workbook => [workbook.workbookId, workbook])) }));
    return {
        current: (action: WorkbookScriptsAction) => service.dispatch(workbookId, action),
        registry: () => service.store.current,
        dispose: () => service.dispose(),
    };
}

describe('WorkbookScriptsRegistryService', () => {
    it('promotes an ephemeral workbook that holds a script', async () => {
        const write = vi.spyOn(StorageWriter.prototype, 'write').mockResolvedValue(true);
        const greeter = {
            ...fixture('greeter'),
            name: 'New Workbook',
            workbookMetadata: { originalFileName: 'hyper', ephemeral: true },
        } as WorkbookScripts;
        const empty = { ...fixture('empty'), name: 'Other', workbookMetadata: { ephemeral: true }, scriptOrder: [] } as unknown as WorkbookScripts;
        const workbooks = [{ ...fixture('other'), name: 'Untitled', workbookMetadata: {} } as WorkbookScripts, greeter, empty];
        const { current, registry, dispose } = createRegistry(workbooks, 'greeter');
        try {

            await step(async () => { await current({ type: REGISTER_QUERY, value: [1, 101] }); });
            const promoted = registry().workbookScriptsMap.get('greeter')!;
            expect(isEphemeralWorkbook(promoted)).toBe(false);
            expect(promoted.workbookMetadata).toEqual({ originalFileName: 'hyper' });
            // A free name among the full workbooks, the name of the other ephemeral workbook is not taken
            expect(promoted.name).toBe('Untitled 2');
            expect(write).toHaveBeenCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['greeter', { name: 'Untitled 2' }],
            }, expect.any(Number));

            // Later writes of the properties don't bring the marker back
            await step(async () => { await current({ type: RENAME_WORKBOOK, value: 'Renamed' }); });
            expect(isEphemeralWorkbook(registry().workbookScriptsMap.get('greeter')!)).toBe(false);
            expect(write).toHaveBeenLastCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['greeter', { name: 'Renamed' }],
            }, expect.any(Number));
        } finally {
            write.mockRestore();
            dispose();
        }
    });

    it('keeps a cloud preview unchanged until it is imported', async () => {
        const write = vi.spyOn(StorageWriter.prototype, 'write').mockResolvedValue(true);
        const cloud = { workbookId: 'c0ffee00-0000-4000-8000-000000000001', versionId: 'c0ffee00-0000-4000-8000-000000000002', connectionId: 'cloud' };
        const preview = {
            ...fixture('preview'),
            name: 'Published',
            workbookMetadata: { originalFileName: '', cloud: { ...cloud, preview: true } },
        } as WorkbookScripts;
        const { current, registry, dispose } = createRegistry([preview], 'preview');
        try {

            // Renaming and reordering change what the workbook says, a preview refuses them
            await step(async () => { await current({ type: RENAME_WORKBOOK, value: 'Renamed' }); });
            await step(async () => { await current({ type: REORDER_SCRIPTS, value: ['1.sql'] }); });
            expect(registry().workbookScriptsMap.get('preview')!.name).toBe('Published');
            expect(write).not.toHaveBeenCalled();
            // What a run registers stays, the runs refuse a preview before they start
            await step(async () => { await current({ type: REGISTER_QUERY, value: [1, 101] }); });
            expect(registry().workbookScriptsMap.get('preview')!.scripts[1].latestQueryId).toBe(101);

            // Importing drops the mark and keeps the link, the properties write it
            await step(async () => { await current({ type: SET_WORKBOOK_CLOUD_LINK, value: cloud }); });
            const imported = registry().workbookScriptsMap.get('preview')!;
            expect(isCloudPreview(imported)).toBe(false);
            expect(imported.workbookMetadata.cloud).toEqual(cloud);
            expect(write).toHaveBeenLastCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['preview', { name: 'Published', cloud }],
            }, expect.any(Number));

            // A rename keeps the link
            await step(async () => { await current({ type: RENAME_WORKBOOK, value: 'Renamed' }); });
            expect(write).toHaveBeenLastCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['preview', { name: 'Renamed', cloud }],
            }, expect.any(Number));
        } finally {
            write.mockRestore();
            dispose();
        }
    });
});
