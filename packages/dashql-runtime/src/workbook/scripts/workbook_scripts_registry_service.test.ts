// The registry of the workbooks of the runtime (WorkbookScriptsRegistryService): what its actions do to a workbook, the
// promotion of the ephemeral workbook and the previews of published workbooks. The hooks of the app stay in the app.
import * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { StorageWriter, WRITE_WORKBOOK_PROPERTIES } from '../../storage/storage_writer.js';
import { TASK_UPDATE_SCHEDULER } from '../../store/store.js';
import { TestLogger } from '../../testing/test_logger.js';
import { WorkbookTestBackend } from '../../testing/workbook_test_backend.js';
import type { WorkbookMetadata } from './script_types.js';
import { createWorkbookScripts, isCloudPreview, isEphemeralWorkbook, REGISTER_QUERY, RENAME_WORKBOOK, REORDER_SCRIPTS, SET_WORKBOOK_CLOUD_LINK, type WorkbookScripts, type WorkbookScriptsAction } from './workbook_scripts.js';
import { WorkbookScriptsRegistryService } from './workbook_scripts_registry_service.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => { vi.restoreAllMocks(); dql.resetUnsafe(); });

/// Run a step of a test and wait for it
const step = async (run: () => unknown) => { await run(); };

/// A workbook with one script `1.sql`, or none
function fixture(workbookId: string, name: string, workbookMetadata: WorkbookMetadata, withScript = true): WorkbookScripts {
    const connection = { connectionId: `${workbookId}-database`, connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: dql.createCatalog() };
    return createWorkbookScripts({
        instance: dql, workbookId, name, workbookMetadata, pendingConnection: withScript ? null : connection,
        scripts: withScript ? [{ name: '1.sql', sql: 'select 1', connection }] : [],
    });
}

/// The key of the script of a fixture
function scriptKey(workbook: WorkbookScripts): number {
    return workbook.scriptRefs['1.sql'].scriptId;
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
        const greeter = fixture('greeter', 'New Workbook', { originalFileName: 'hyper', ephemeral: true } as WorkbookMetadata);
        const empty = fixture('empty', 'Other', { ephemeral: true } as WorkbookMetadata, false);
        const workbooks = [fixture('other', 'Untitled', {} as WorkbookMetadata), greeter, empty];
        const { current, registry, dispose } = createRegistry(workbooks, 'greeter');
        try {

            await step(async () => { await current({ type: REGISTER_QUERY, value: [scriptKey(greeter), 101] }); });
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
        const preview = fixture('preview', 'Published', { originalFileName: '', cloud: { ...cloud, preview: true } } as WorkbookMetadata);
        const { current, registry, dispose } = createRegistry([preview], 'preview');
        try {

            // Renaming and reordering change what the workbook says, a preview refuses them
            await step(async () => { await current({ type: RENAME_WORKBOOK, value: 'Renamed' }); });
            await step(async () => { await current({ type: REORDER_SCRIPTS, value: ['1.sql'] }); });
            expect(registry().workbookScriptsMap.get('preview')!.name).toBe('Published');
            expect(write).not.toHaveBeenCalled();
            // What a run registers stays, the runs refuse a preview before they start
            await step(async () => { await current({ type: REGISTER_QUERY, value: [scriptKey(preview), 101] }); });
            expect(registry().workbookScriptsMap.get('preview')!.scripts[scriptKey(preview)].latestQueryId).toBe(101);

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
