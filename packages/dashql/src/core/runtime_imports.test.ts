import * as dashql from './index.js';

import { loadCoreWasm, MemoryStorage, testPlatform } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

/// The ids of a stored workbook and its connection, UUIDs
const WB = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
/// A connection of the app that describes the same database under another id
const EXISTING = '33333333-3333-4333-8333-333333333333';
const TRINO = { trino: { endpoint: 'https://trino.example' } };

/// An archive of the test: the entries in memory, a table as the Arrow IPC of its rows instead of Parquet
interface TestArchive {
    entries: { filename: string; table: Uint8Array | null; file: unknown }[];
}

/// The archives of a test platform without zip.js and Hyper
function testArchives(handles: dashql.RuntimeHandles): dashql.RuntimeArchives {
    const archive = (handle: number) => handles.get(handle) as TestArchive;
    return {
        write: async entries => ({
            entries: entries.map(entry => ({ filename: entry.fileName, table: entry.table, file: entry.file == null ? null : handles.get(entry.file) })),
        }) as unknown as Blob,
        bytes: async () => new TextEncoder().encode('archive'),
        entries: async handle => archive(handle).entries.map(entry => ({ filename: entry.filename, directory: false })),
        readText: async () => { throw new Error('the archive holds no texts'); },
        readTable: async (handle, index) => archive(handle).entries[index].table!,
        readFile: async (handle, index) => ({ file: archive(handle).entries[index].file as Blob, crc32: null }),
        close: async () => { },
    };
}

/// A runtime over a storage that holds a workbook on a Trino connection with a script and an attachment
function createRuntime() {
    const storage = new MemoryStorage();
    storage.workbooks.set(WB, {
        formatVersion: 11,
        workbookId: WB,
        name: 'Sales',
        connections: [{ connectionId: CONNECTION, params: TRINO }],
        scripts: [{ name: 'a.sql', connectionId: CONNECTION }],
        attachments: [{ name: 'data.parquet' }],
        metadata: {},
    });
    storage.scripts.set(WB, new Map([['a.sql', 'select 1']]));
    storage.dataFiles.set(WB, new Map([['data.parquet', new Uint8Array([1, 2, 3])]]));
    storage.order.push(WB);
    const test = testPlatform(storage);
    const platform = { ...test.platform, archives: testArchives(test.platform.handles) };
    const runtime = dql!.createRuntime(platform);
    runtime.runCatalogLoader(false);
    return { runtime, platform, storage };
}

describe('The imports and exports of the runtime', () => {
    it('export the workbook tables with the attachments by handle', async () => {
        const { runtime, platform } = createRuntime();
        let rows: Record<string, Record<string, unknown>[]> = {};
        let files: unknown[] = [];
        const outcome = await runtime.exportWorkbook(WB, { format: 'tables', preserveUuids: true }, async tables => {
            rows = tables.rows;
            files = tables.data.map(entry => platform.handles.get(entry.file));
        });
        expect(outcome.results).toEqual({ cachedScripts: 0, totalScripts: 0, files: 0, bytes: 0 });
        expect(rows['workbook']).toEqual([expect.objectContaining({ workbook_id: WB, name: 'Sales' })]);
        expect(rows['workbook_scripts']).toEqual([expect.objectContaining({ name: 'a.sql', connection_id: CONNECTION, text: 'select 1' })]);
        expect(rows['workbook_attachments']).toEqual([expect.objectContaining({ name: 'data.parquet' })]);
        // The attachment stays with the host, the export names it by handle
        expect(files).toEqual([new Uint8Array([1, 2, 3])]);
        runtime.free();
    });

    it('export an archive and a link, and import the archive as a new workbook', async () => {
        const { runtime, platform, storage } = createRuntime();
        const exported = await runtime.exportWorkbook(WB, { format: 'archive' }, null);
        expect(exported.archive).not.toBeNull();
        const link = await runtime.exportWorkbook(WB, { format: 'link', linkBase: 'https://app.dashql.app' }, null);
        expect(link.link).toMatch(/^https:\/\/app\.dashql\.app\/\?zip=/);

        // The export gave the workbook and its connection fresh ids, the import registers it as a new workbook
        const preview = await runtime.readImport({ archive: exported.archive! });
        const workbook = preview.workbook as { workbookId: string; name: string; connections: { connectionId: string }[] };
        expect(workbook.workbookId).not.toBe(WB);
        expect(workbook.name).toBe('Sales');
        expect(preview).toMatchObject({ scriptCount: 1, attachmentCount: 1, conflict: null, questions: [], filesValid: true });

        const steps: string[] = [];
        const outcome = await runtime.commitImport(preview.importId, {}, step => steps.push(step));
        expect(outcome).toMatchObject({ workbookId: workbook.workbookId, restored: true, results: null });
        expect(outcome.registered).toEqual([workbook.connections[0].connectionId]);
        expect(steps).toEqual(['workbook', 'scripts', 'attachments', 'open']);
        expect(storage.scripts.get(workbook.workbookId)).toEqual(new Map([['a.sql', 'select 1']]));
        expect(storage.dataFiles.get(workbook.workbookId)).toEqual(new Map([['data.parquet', new Uint8Array([1, 2, 3])]]));
        // The runtime restored the workbook
        expect(runtime.views('workbook', [workbook.workbookId])[0]).toMatchObject({ name: 'Sales' });
        platform.handles.release(exported.archive!);
        runtime.free();
    });

    it('ask about connections that describe the same database and replace a registered workbook', async () => {
        const { runtime, storage } = createRuntime();
        storage.connections = [{ id: EXISTING, params: TRINO, name: 'Warehouse' }];
        const exported = await runtime.exportWorkbook(WB, { format: 'archive', preserveUuids: true }, null);

        const preview = await runtime.readImport({ archive: exported.archive! });
        expect(preview.conflict).toMatchObject({ workbookId: WB });
        expect(preview.questions).toEqual([
            expect.objectContaining({ connectionId: CONNECTION, candidates: [expect.objectContaining({ id: EXISTING, name: 'Warehouse' })] }),
        ]);
        // An import without an answer to the conflict fails, nothing is written
        await expect(runtime.commitImport(preview.importId, {}, null)).rejects.toThrow(/added meanwhile/);

        const again = await runtime.readImport({ archive: exported.archive! });
        const outcome = await runtime.commitImport(again.importId, {
            conflict: 'replace',
            connections: { [CONNECTION]: { kind: 'link', connectionId: EXISTING } },
        }, null);
        // A replacement is not restored, the app reloads
        expect(outcome).toMatchObject({ workbookId: WB, restored: false, registered: [] });
        const written = storage.workbooks.get(WB) as { connections: { connectionId: string }[]; scripts: { connectionId: string }[] };
        expect(written.connections.map(connection => connection.connectionId)).toEqual([EXISTING]);
        expect(written.scripts.map(script => script.connectionId)).toEqual([EXISTING]);
        // The staged copy is gone
        expect(storage.order).toEqual([WB]);

        // Create New gives the copy a fresh id and a name of its own
        const copy = await runtime.readImport({ archive: exported.archive! });
        const created = await runtime.commitImport(copy.importId, { conflict: 'create-new', preview: true }, null);
        expect(created.workbookId).not.toBe(WB);
        expect(created.unasked).toBe(true);
        expect(storage.workbooks.get(created.workbookId)).toMatchObject({ name: 'Sales (copy)' });
        runtime.free();
    });

    it('write the pending writes of a replaced workbook first and discard the later ones', async () => {
        const { runtime, storage } = createRuntime();
        const exported = await runtime.exportWorkbook(WB, { format: 'archive', preserveUuids: true }, null);
        // The workbook is registered and has an edit that waits for its debounce
        await runtime.restore(null);
        const scriptKey = (runtime.views('workbook', [WB])[0] as { scriptKeys: number[] }).scriptKeys[0];
        expect(runtime.dispatch({ workbook: WB }, { kind: 'setScriptText', value: { scriptKey, text: 'select 42' } }).changed).toBe(true);
        expect(storage.scripts.get(WB)?.get('a.sql')).toBe('select 1');

        // The writes of the script in order; an edit while the replacement writes is held
        const writes: string[] = [];
        let laterEdit: dashql.DispatchOutcome | null = null;
        const saveScript = storage.saveScript;
        storage.saveScript = async (workbookId, fileName, text) => {
            if (workbookId === WB && fileName === 'a.sql') {
                writes.push(text);
                if (text === 'select 1' && laterEdit == null) {
                    laterEdit = runtime.dispatch({ workbook: WB }, { kind: 'setScriptText', value: { scriptKey, text: 'select 43' } });
                }
            }
            await saveScript(workbookId, fileName, text);
        };
        const preview = await runtime.readImport({ archive: exported.archive! });
        const outcome = await runtime.commitImport(preview.importId, { conflict: 'replace' }, null);
        expect(outcome).toMatchObject({ workbookId: WB, restored: false });

        // The pending edit reached the storage before the replacement wrote the script of the import
        expect(writes.slice(0, 2)).toEqual(['select 42', 'select 1']);
        expect(laterEdit).toMatchObject({ ok: true, changed: true });
        // The edit during the replacement belongs to the replaced version, it is discarded
        await runtime.storage({ kind: 'flush', closing: true });
        expect(writes).not.toContain('select 43');
        // Until the app reloads, the workbook of the runtime is the replaced version: an edit after the import is never
        // written, not even when the page hides
        expect(runtime.dispatch({ workbook: WB }, { kind: 'setScriptText', value: { scriptKey, text: 'select 44' } }).changed).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 150));
        await runtime.storage({ kind: 'flush', closing: true });
        expect(writes).not.toContain('select 44');
        expect(storage.scripts.get(WB)?.get('a.sql')).toBe('select 1');
        runtime.free();
    });

    it('roll back the replacement of a workbook that the format can no longer read', async () => {
        const { runtime, storage } = createRuntime();
        const exported = await runtime.exportWorkbook(WB, { format: 'archive', preserveUuids: true }, null);
        // A newer version of the app wrote the registered workbook, the import is its recovery
        const newer = { ...(structuredClone(storage.workbooks.get(WB)) as object), formatVersion: 99, future: 'kept' };
        storage.workbooks.set(WB, newer);

        // The first write of a script of the target fails, after its files were copied aside and removed
        const saveScript = storage.saveScript;
        let failed = false;
        storage.saveScript = async (workbookId, fileName, text) => {
            if (workbookId === WB && !failed) {
                failed = true;
                throw new Error('disk full');
            }
            await saveScript(workbookId, fileName, text);
        };
        const preview = await runtime.readImport({ archive: exported.archive! });
        await expect(runtime.commitImport(preview.importId, { conflict: 'replace' }, null)).rejects.toThrow(/disk full/);
        expect(failed).toBe(true);

        // The files of the newer version are back as they were, the staged copies are gone
        expect(storage.workbooks.get(WB)).toEqual(newer);
        expect(storage.scripts.get(WB)).toEqual(new Map([['a.sql', 'select 1']]));
        expect(storage.dataFiles.get(WB)).toEqual(new Map([['data.parquet', new Uint8Array([1, 2, 3])]]));
        expect(storage.order).toEqual([WB]);
        expect([...storage.workbooks.keys()]).toEqual([WB]);
        runtime.free();
    });

    it('import a workbook whose catalogs can not be seeded', async () => {
        const { runtime, storage } = createRuntime();
        storage.connectionFiles.set(`${CONNECTION}/dashql-catalog-relations.sql`, 'CREATE TABLE db.public.t (id integer);');
        const exported = await runtime.exportWorkbook(WB, { format: 'archive', preserveUuids: true, withCatalog: true }, null);
        storage.connectionFiles.clear();
        // The catalogs are a cache of the connections, a failure to seed them leaves the import alone
        storage.saveConnectionFile = async () => { throw new Error('quota exceeded'); };
        const preview = await runtime.readImport({ archive: exported.archive! });
        const outcome = await runtime.commitImport(preview.importId, { conflict: 'replace' }, null);
        expect(outcome).toMatchObject({ workbookId: WB, restored: false });
        expect(storage.scripts.get(WB)).toEqual(new Map([['a.sql', 'select 1']]));
        expect(storage.order).toEqual([WB]);
        runtime.free();
    });

    it('roll back a replacement whose write fails in the middle', async () => {
        const { runtime, storage } = createRuntime();
        const exported = await runtime.exportWorkbook(WB, { format: 'archive', preserveUuids: true }, null);
        // The registered workbook changed since the export
        storage.scripts.set(WB, new Map([['a.sql', 'select 2']]));
        const registered = structuredClone(storage.workbooks.get(WB));

        // The first write of a script of the target fails, after the staged copy was verified and the files of the
        // target were removed
        const saveScript = storage.saveScript;
        let failed = false;
        storage.saveScript = async (workbookId, fileName, text) => {
            if (workbookId === WB && !failed) {
                failed = true;
                throw new Error('disk full');
            }
            await saveScript(workbookId, fileName, text);
        };
        const preview = await runtime.readImport({ archive: exported.archive! });
        await expect(runtime.commitImport(preview.importId, { conflict: 'replace' }, null)).rejects.toThrow(/disk full/);
        expect(failed).toBe(true);

        // The old workbook is back and the staged copy is gone
        expect(storage.workbooks.get(WB)).toEqual(registered);
        expect(storage.scripts.get(WB)).toEqual(new Map([['a.sql', 'select 2']]));
        expect(storage.dataFiles.get(WB)).toEqual(new Map([['data.parquet', new Uint8Array([1, 2, 3])]]));
        expect(storage.order).toEqual([WB]);
        expect([...storage.workbooks.keys()]).toEqual([WB]);
        runtime.free();
    });

    it('read a workbook folder and drop the import', async () => {
        const { runtime, storage } = createRuntime();
        const folder: dashql.RuntimeImportFolder = {
            readText: async path => path === 'dashql-workbook.json' ? JSON.stringify(storage.workbooks.get(WB)) : null,
            scripts: async () => [{ name: 'a.sql', sql: 'select 1' }, { name: 'b.sql', sql: 'select 2' }],
            attachments: async () => [],
            metadata: { originType: 'HTTP', originalHttpUrl: 'https://example.com/dashql-workbook.json' },
        };
        const preview = await runtime.readImport({ folder });
        // A script file that the workbook file doesn't list is appended
        expect((preview.workbook as { scripts: { name: string }[] }).scripts.map(script => script.name)).toEqual(['a.sql', 'b.sql']);
        expect((preview.workbook as { metadata: unknown }).metadata).toMatchObject({ originType: 'HTTP' });
        runtime.dropImport(preview.importId);
        await expect(runtime.commitImport(preview.importId, {}, null)).rejects.toThrow(/no pending import/);
        await expect(runtime.readImport({ folder: { ...folder, readText: async () => null } })).rejects.toThrow(/Invalid workbook folder/);
        // A script file name that could leave the folder, a draft, another file or a name that differs only in case
        // never reaches the storage
        for (const [names, message] of [
            [['../x.sql'], /invalid script name \.\.\/x\.sql/],
            [['a/b.sql'], /invalid script name a\/b\.sql/],
            [['x.txt'], /invalid script name x\.txt/],
            [['dashql-draft.sql'], /invalid script name dashql-draft\.sql/],
            [['A.sql', 'a.sql'], /duplicate script a\.sql/],
        ] as const) {
            const scripts = async () => names.map(name => ({ name, sql: 'select 1' }));
            await expect(runtime.readImport({ folder: { ...folder, scripts } })).rejects.toThrow(message);
        }
        runtime.free();
    });
});
