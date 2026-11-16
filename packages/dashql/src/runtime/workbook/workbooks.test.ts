// The workbooks of the runtime on a runtime of the tests: the restore of the stored workbooks with their connections, the
// workbooks that are refused a load, the promotion of the ephemeral workbook, the writes of the changes of the scripts
// and the workbooks that use a connection. The workbook itself is tested in Rust
// (packages/dashql-core-runtime/tests/workbook_test.rs), the views in `runtime_workbooks.test.ts` of packages/dashql/src/core.
import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionParams } from '../../platform/connections/connection_params.js';
import { storageVersions } from '../../platform/storage/storage_versions.js';
import type { WorkbookData } from '../../platform/storage/storage_backend.js';
import { createTestRuntime, testCore, type TestRuntime } from '../testing/test_runtime.js';
import { TEST_CONNECTION_ID, TEST_WORKBOOK_ID, WorkbookTestBackend, WorkbookTestRegistry, testWorkbook } from '../../platform/testing/workbook_test_backend.js';

/// A Hyper server, its catalog outlives the app
const HYPER = { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as ConnectionParams;
/// Another stored connection
const OTHER_CONNECTION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff';

describe('the workbooks of the runtime', () => {
    let runtime: TestRuntime | null = null;
    afterEach(async () => {
        await runtime?.destroy();
        runtime = null;
    });

    it('restores the stored workbooks with the connections of the app manifest', async () => {
        const storage = new WorkbookTestRegistry();
        storage.connections = [{ id: TEST_CONNECTION_ID, params: HYPER }];
        await storage.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            name: 'Sales',
            connections: [{ connectionId: TEST_CONNECTION_ID, params: HYPER }],
            scripts: [{ name: '2_query.sql', connectionId: TEST_CONNECTION_ID }, { name: '1_create.sql', connectionId: TEST_CONNECTION_ID }],
        }));
        await storage.saveScript(TEST_WORKBOOK_ID, '1_create.sql', 'create table t (x int);');
        await storage.saveScript(TEST_WORKBOOK_ID, '2_query.sql', 'select x from t;');
        // A workbook of a format that the app doesn't read is refused a load, it can only be deleted
        const invalid = '11111111-2222-4333-8444-666666666666';
        await testCore();
        await storage.saveWorkbookManifest(invalid, testWorkbook({ workbookId: invalid, formatVersion: (storageVersions().formatVersion + 100) as WorkbookData['formatVersion'] }));

        const rt = runtime = await createTestRuntime({ storage });
        const progress: unknown[] = [];
        const outcome = await rt.restore(update => progress.push(update));
        expect(outcome.connectionIds).toEqual([TEST_CONNECTION_ID]);
        expect(outcome.workbookIds).toEqual([TEST_WORKBOOK_ID]);
        expect(outcome.invalidWorkbooks.map(workbook => workbook.workbookId)).toEqual([invalid]);
        expect(progress.length).toBeGreaterThan(0);

        // The scripts in the order of the workbook file, their texts from their files
        const workbook = rt.store.get('workbook', TEST_WORKBOOK_ID)!;
        expect(workbook).toMatchObject({ name: 'Sales', scriptOrder: ['2_query.sql', '1_create.sql'], connectionIds: [TEST_CONNECTION_ID] });
        const scripts = rt.scripts(TEST_WORKBOOK_ID);
        expect(workbook.scriptKeys.map(key => scripts[key].scriptSession.getText())).toEqual(['select x from t;', 'create table t (x int);']);
        // The connection knows the workbook that uses it, the list of the workbooks the refused one
        expect(rt.connection(TEST_CONNECTION_ID).workbooks).toEqual([TEST_WORKBOOK_ID]);
        expect(rt.store.get('workbookList', 'root')?.invalidWorkbooks.map(workbook => workbook.workbookId)).toEqual([invalid]);

        // Deleting the refused workbook deletes its files and drops it from the list
        await rt.deleteInvalidWorkbook(invalid);
        expect(rt.store.get('workbookList', 'root')?.invalidWorkbooks).toEqual([]);
        expect(storage.workbooks.has(invalid)).toBe(false);
    });

    it('writes the changes of the scripts through the storage writer', async () => {
        const storage = new WorkbookTestBackend();
        const rt = runtime = await createTestRuntime({ storage });
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        const workbook = rt.addWorkbook(TEST_CONNECTION_ID, [['a.sql', 'select 1;']], { name: 'Writes' });
        const { workbookId } = workbook;
        await rt.storage.flush();
        expect(storage.scripts.get(workbookId)).toEqual(new Map([['a.sql', 'select 1;']]));
        expect(storage.workbooks.get(workbookId)).toMatchObject({ name: 'Writes', scripts: [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }] });

        const [key] = workbook.scriptKeys;
        rt.dispatch({ workbook: workbookId }, { kind: 'setScriptText', value: { scriptKey: key, text: 'select 2;' } });
        rt.dispatch({ workbook: workbookId }, { kind: 'renameScript', value: { fileName: 'a.sql', newName: 'b' } });
        rt.dispatch({ workbook: workbookId }, { kind: 'renameWorkbook', value: { name: 'Renamed' } });
        await rt.storage.flush();
        expect(storage.scripts.get(workbookId)).toEqual(new Map([['b.sql', 'select 2;']]));
        expect(storage.workbooks.get(workbookId)).toMatchObject({ name: 'Renamed', scripts: [{ name: 'b.sql', connectionId: TEST_CONNECTION_ID }] });

        rt.dispatch({ workbook: workbookId }, { kind: 'deleteScript', value: { fileName: 'b.sql' } });
        await rt.storage.flush();
        expect(storage.scripts.get(workbookId)).toEqual(new Map());
        expect(storage.workbooks.get(workbookId)).toMatchObject({ scripts: [] });
    });

    it('promotes the ephemeral workbook with its first script to a name that no other workbook has', async () => {
        const rt = runtime = await createTestRuntime();
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        rt.addWorkbook(TEST_CONNECTION_ID, [], { name: 'Untitled' });
        const ephemeral = rt.addWorkbook(TEST_CONNECTION_ID, [], { name: 'New Workbook', ephemeral: true });
        expect(ephemeral.ephemeral).toBe(true);
        rt.dispatch({ workbook: ephemeral.workbookId }, { kind: 'createScript', value: { text: 'select 1', base: 'a' } });
        rt.flush();
        expect(rt.store.get('workbook', ephemeral.workbookId)).toMatchObject({ ephemeral: false, name: 'Untitled 2' });
        expect(rt.store.get('workbook', ephemeral.workbookId)!.workbookMetadata.ephemeral).toBeUndefined();
    });

    it('tells the connections which workbooks use them', async () => {
        const rt = runtime = await createTestRuntime();
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        await rt.addConnection({ connectionId: OTHER_CONNECTION_ID, params: HYPER });
        const workbook = rt.addWorkbook(TEST_CONNECTION_ID, [['a.sql', 'select 1;'], ['b.sql', 'select 2;']]);
        expect(rt.connection(TEST_CONNECTION_ID).workbooks).toEqual([workbook.workbookId]);
        expect(rt.connection(OTHER_CONNECTION_ID).workbooks).toEqual([]);

        // A script moves to the other connection, both connections are used
        rt.dispatch({ workbook: workbook.workbookId }, { kind: 'setScriptConnection', value: { fileName: 'b.sql', connectionId: OTHER_CONNECTION_ID } });
        rt.flush();
        expect(rt.store.get('workbook', workbook.workbookId)?.connectionIds).toEqual([TEST_CONNECTION_ID, OTHER_CONNECTION_ID]);
        expect(rt.connection(OTHER_CONNECTION_ID).workbooks).toEqual([workbook.workbookId]);
        // A connection that a workbook uses is never deleted
        expect(rt.dispatch({ connection: OTHER_CONNECTION_ID }, { kind: 'deleteConnection' }).ok).toBe(false);

        // Without the workbook, the connections are free
        rt.deleteWorkbook(workbook.workbookId);
        expect(rt.store.get('workbook', workbook.workbookId)).toBeNull();
        expect(rt.connection(TEST_CONNECTION_ID).workbooks).toEqual([]);
        expect(rt.dispatch({ connection: OTHER_CONNECTION_ID }, { kind: 'deleteConnection' }).ok).toBe(true);
    });
});
