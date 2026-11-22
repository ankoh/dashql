// The workbooks of the runtime on a runtime of the tests: the restore of the stored workbooks with their connections, the
// workbooks that are refused a load, the promotion of the ephemeral workbook, the writes of the changes of the scripts
// and the workbooks that use a connection. The workbook itself is tested in Rust
// (packages/dashql-core-runtime/tests/workbook_test.rs), the views in `runtime_workbooks.test.ts` of packages/dashql/src/core.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionParams } from '../platform/connections/connection_params.js';
import type { WorkbookData } from '../platform/storage/storage_backend.js';
import { createTestRuntime, restoreTestWorkbook, testCore, type TestRuntime } from './testing/test_runtime.js';
import { TEST_CONNECTION_ID, TEST_WORKBOOK_ID, WorkbookTestBackend, WorkbookTestRegistry, testWorkbook } from '../platform/testing/workbook_test_backend.js';

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
        const dql = await testCore();
        const storage = new WorkbookTestRegistry(dql);
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
        await storage.saveWorkbookManifest(invalid, testWorkbook({ workbookId: invalid, formatVersion: (dql.storageVersions().formatVersion + 100) as WorkbookData['formatVersion'] }));

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

    it('lists a file that is attached while its workbook is held, the file follows with the release', async () => {
        const storage = new WorkbookTestBackend();
        const rt = runtime = await createTestRuntime({ storage });
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        const { workbookId } = rt.addWorkbook(TEST_CONNECTION_ID, [['sales.sql', 'select 1;']], { name: 'Held' });
        await rt.storage.flush();

        rt.storage.hold('externalChange', workbookId);
        const outcome = await rt.attachFiles(workbookId, [{ name: 'orders.parquet', file: new TextEncoder().encode('abc') }]);
        expect(outcome.attached).toEqual([{ name: 'orders.parquet', fileName: 'orders.parquet' }]);
        expect(await storage.listDataFiles(workbookId)).toEqual([]);
        // The write waits for the hold, the view lists the file all the same
        expect(rt.store.get('workbook', workbookId)!.attachments?.map(attachment => [attachment.fileName, attachment.sizeBytes])).toEqual([['orders.parquet', 3]]);
        // A refresh during the hold keeps it
        await rt.refreshAttachments(workbookId);
        expect(rt.store.get('workbook', workbookId)!.attachments?.map(attachment => attachment.fileName)).toEqual(['orders.parquet']);

        rt.storage.release('externalChange', workbookId);
        await rt.storage.flush();
        expect((await storage.listDataFiles(workbookId)).map(file => file.name)).toEqual(['orders.parquet']);
        await rt.refreshAttachments(workbookId);
        expect(rt.store.get('workbook', workbookId)!.attachments?.map(attachment => [attachment.fileName, attachment.sizeBytes])).toEqual([['orders.parquet', 3]]);
    });

    it('attaches files through the storage writer and lists them in the view of the workbook', async () => {
        const storage = new WorkbookTestBackend();
        const rt = runtime = await createTestRuntime({ storage });
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        const { workbookId } = rt.addWorkbook(TEST_CONNECTION_ID, [['sales.sql', 'select 1;']], { name: 'Attachments' });
        await rt.storage.flush();

        // The table parameter of an attachment takes no name of a script or another attachment, files that are no
        // Parquet files are refused
        const parquet = (content: string) => new Blob([content]);
        const outcome = await rt.attachFiles(workbookId, [
            { name: 'Sales.parquet', file: parquet('a') },
            { name: 'orders.parquet', file: new TextEncoder().encode('bb') },
            { name: 'ORDERS.parquet', file: parquet('ccc') },
            { name: 'notes.txt', file: parquet('d') },
        ]);
        expect(outcome).toEqual({
            attached: [
                { name: 'Sales.parquet', fileName: 'Sales-2.parquet' },
                { name: 'orders.parquet', fileName: 'orders.parquet' },
                { name: 'ORDERS.parquet', fileName: 'ORDERS-2.parquet' },
            ],
            refused: ['notes.txt'],
        });
        expect(new Map((await storage.listDataFiles(workbookId)).map(file => [file.name, file.sizeBytes]))).toEqual(new Map([
            ['orders.parquet', 2], ['ORDERS-2.parquet', 3], ['Sales-2.parquet', 1],
        ]));
        // The view of the workbook is the one list of the attachments, in natural order with their table parameters
        expect(rt.store.get('workbook', workbookId)!.attachments?.map(attachment => [attachment.fileName, attachment.name, attachment.sizeBytes])).toEqual([
            ['ORDERS-2.parquet', 'ORDERS-2', 3], ['orders.parquet', 'orders', 2], ['Sales-2.parquet', 'Sales-2', 1],
        ]);
        // The workbook file lists them once the writer wrote it
        await rt.storage.flush();
        expect(storage.workbooks.get(workbookId)?.attachments.map(attachment => attachment.name)).toEqual(['ORDERS-2.parquet', 'orders.parquet', 'Sales-2.parquet']);

        // A file with the name of an attachment replaces it, a removed one leaves the view with a refresh
        await rt.attachFiles(workbookId, [{ name: 'orders.parquet', file: parquet('eeee') }]);
        await storage.deleteDataFile(workbookId, 'Sales-2.parquet');
        await rt.refreshAttachments(workbookId);
        expect(rt.store.get('workbook', workbookId)!.attachments?.map(attachment => [attachment.fileName, attachment.sizeBytes])).toEqual([
            ['ORDERS-2.parquet', 3], ['orders.parquet', 4],
        ]);
    });

    it('lists the attachments of a folder in its workbook file with their names in NFC', async () => {
        const storage = new WorkbookTestBackend();
        const rt = runtime = await createTestRuntime({ storage });
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        const { workbookId } = rt.addWorkbook(TEST_CONNECTION_ID, [['sales.sql', 'select 1;']], { name: 'Attachments' });
        await rt.storage.flush();
        // A file that another platform wrote with a decomposed name
        await storage.saveDataFile(workbookId, 'cafe\u0301.parquet', new Blob(['a']));
        await rt.refreshAttachments(workbookId);
        await rt.storage.flush();
        expect(storage.workbooks.get(workbookId)?.attachments.map(attachment => attachment.name)).toEqual(['caf\u00e9.parquet']);
    });

    it('renames an attachment with its file and the scripts that read it, a refused rename changes nothing', async () => {
        const storage = new WorkbookTestBackend();
        const rt = runtime = await createTestRuntime({ storage });
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        const { workbookId } = rt.addWorkbook(TEST_CONNECTION_ID, [['reader.sql', 'select * from :sales;']], { name: 'Attachments' });
        await rt.attachFiles(workbookId, [{ name: 'sales.parquet', file: new Blob(['a']) }]);
        const fileNames = async () => (await storage.listDataFiles(workbookId)).map(file => file.name);
        const text = () => rt.scripts(workbookId)[rt.store.get('workbook', workbookId)!.scriptKeys[0]].scriptSession.getText();

        // The name of a script is taken, the file and the script read the next free name
        await expect(rt.renameAttachment(workbookId, 'sales.parquet', 'reader')).resolves.toBe('reader-2.parquet');
        expect(await fileNames()).toEqual(['reader-2.parquet']);
        expect(text()).toBe('select * from :"reader-2";');
        expect(rt.store.get('workbook', workbookId)!.attachments?.map(attachment => attachment.fileName)).toEqual(['reader-2.parquet']);
        await expect(rt.renameAttachment(workbookId, 'reader-2.parquet', 'a/b')).resolves.toBeNull();

        // A preview of a published workbook refuses the rename before the file moved
        rt.dispatch({ workbook: workbookId }, { kind: 'setCloudLink', value: { link: { workbookId: 'c', versionId: 'v', preview: true } } });
        await expect(rt.renameAttachment(workbookId, 'reader-2.parquet', 'revenue')).rejects.toThrow();
        expect(await fileNames()).toEqual(['reader-2.parquet']);
        expect(text()).toBe('select * from :"reader-2";');
    });

    it('outdates the scripts of the other workbooks on a catalog that a script changed', async () => {
        const rt = runtime = await createTestRuntime();
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        const tables = rt.addWorkbook(TEST_CONNECTION_ID, [['tables.sql', 'create table t (x int);']], { name: 'Tables' });
        const queries = rt.addWorkbook(TEST_CONNECTION_ID, [['query.sql', 'select x from t;']], { name: 'Queries' });
        const [query] = queries.scriptKeys;
        rt.dispatch({ workbook: queries.workbookId }, { kind: 'analyzeOutdatedScript', value: { scriptKey: query } });
        rt.flush();
        expect(rt.store.get('script', query)?.analysisOutdated).toBe(false);
        // The table of the other workbook gets a column
        rt.dispatch({ workbook: tables.workbookId }, { kind: 'setScriptText', value: { scriptKey: tables.scriptKeys[0], text: 'create table t (x int, y int);' } });
        rt.flush();
        expect(rt.store.get('script', query)?.analysisOutdated).toBe(true);
    });

    it('keeps the session handle of a script usable for an editor that still holds it', async () => {
        const rt = runtime = await createTestRuntime();
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        await rt.addConnection({ connectionId: OTHER_CONNECTION_ID, params: HYPER });
        const { workbookId, scriptKeys: [key] } = rt.addWorkbook(TEST_CONNECTION_ID, [['a.sql', 'select 1;']]);
        const held = rt.store.get('script', key)!.scriptSession;
        // The script moves into a session of another connection, the store takes the new handle with the flush
        rt.dispatch({ workbook: workbookId }, { kind: 'setScriptConnection', value: { fileName: 'a.sql', connectionId: OTHER_CONNECTION_ID } });
        rt.flush();
        expect(rt.store.get('script', key)!.scriptSession).not.toBe(held);
        // The editor reads the old handle until it takes the new one
        expect(held.getText()).toBe('select 1;');
        rt.dispatch({ workbook: workbookId }, { kind: 'deleteScript', value: { fileName: 'a.sql' } });
        rt.flush();
        expect(held.getText()).toBe('select 1;');
    });

    it('hands out the session of a script as a handle that only reads it', async () => {
        const rt = runtime = await createTestRuntime();
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        const { scriptKeys: [key] } = rt.addWorkbook(TEST_CONNECTION_ID, [['a.sql', 'select 1;']]);
        const native = rt.module.scriptSession(key)!;
        for (const mutator of ['replaceText', 'apply', 'setPrimaryCursor', 'analyze', 'loadIntoCatalog', 'dropFromCatalog']) {
            expect(mutator in native).toBe(false);
        }
        expect(native.text()).toBe('select 1;');
        native.free();
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

    it('analyzes the outdated scripts that the editors show', async () => {
        const rt = runtime = await createTestRuntime();
        await rt.addConnection({ connectionId: TEST_CONNECTION_ID, params: HYPER });
        // A restored workbook is not analyzed yet
        const workbook = await restoreTestWorkbook(rt, rt.options.storage!, [
            ['a.sql', 'select 1;', TEST_CONNECTION_ID], ['b.sql', 'select 2;', TEST_CONNECTION_ID], ['c.sql', 'select 3;', TEST_CONNECTION_ID],
        ]);
        const [a, b, c] = workbook.scriptKeys;
        const outdated = (key: number) => rt.store.get('script', key)?.analysisOutdated;
        expect([a, b, c].map(outdated)).toEqual([true, true, true]);
        const show = (scriptKey: number, selected: boolean) => rt.dispatch({ workbook: workbook.workbookId }, { kind: 'showScript', value: { scriptKey, selected } });

        // The selected script right away, a shown one once the changes paused, one that no editor shows not at all
        expect(show(a, true).ok).toBe(true);
        show(b, false);
        rt.flush();
        expect([a, b, c].map(outdated)).toEqual([false, true, true]);
        await vi.waitFor(() => {
            rt.flush();
            expect(outdated(b)).toBe(false);
        });
        await rt.clock.elapse();
        rt.flush();
        expect(outdated(c)).toBe(true);
        expect(rt.dispatch({ workbook: workbook.workbookId }, { kind: 'hideScript', value: { scriptKey: b, selected: false } }).ok).toBe(true);
    });
});
