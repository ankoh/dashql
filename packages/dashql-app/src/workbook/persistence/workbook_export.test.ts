import * as dashql from '@ankoh/dashql-core';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE64URL_CODEC } from '../../utils/base64.js';
import { Crc32 } from '../../utils/crc32.js';
import {
    createWorkbookZip,
    exportWorkbookAsSharedZip,
    exportConnectionAsUrl,
    exportWorkbookAsUrl,
    exportWorkbookAsZip,
    WorkbookLinkTarget,
} from './workbook_export.js';
import { importWorkbookFromZip, readWorkbookBundleFromZip } from './workbook_import.js';
import { workbookBundlesEqual, type WorkbookBundle } from '../../storage/workbook_bundle.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testConnections, testWorkbook } from '../../storage/workbook_test_backend.js';
import type { ParquetReadDatabase } from '../../storage/workbook_tables_parquet.js';
import { createTestHyperDB } from '../../tests/hyperdb_test_client.js';
import type { WorkbookArchiveWriter } from './workbook_archive_database.js';
import { BlobReader, ZipReader } from './workbook_zip.js';
import { generateCatalogFunctionsSQL, generateCatalogRelationsSQL } from '../../connections/catalog/catalog_structure.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let database: ParquetReadDatabase;
let writer: WorkbookArchiveWriter;
let disposeDatabase: () => Promise<void>;
beforeAll(async () => {
    const test = await createTestHyperDB('dashql-workbook-export');
    database = test.database;
    disposeDatabase = test.dispose;
    writer = { database, core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }) };
}, 60_000);
afterAll(async () => {
    await disposeDatabase?.();
});

/// A catalog file of relations with one table, as the app renders it
const relationsOf = (tableName: string) => generateCatalogRelationsSQL([
    { databaseName: 'hyper', schemaName: 'public', tableName, columns: [{ name: 'id', ordinalPosition: 0, dataType: 'integer' }] },
]);
const SCHEMA = relationsOf('items');
const OTHER_SCHEMA = relationsOf('other_items');
const EMBEDDED_SCHEMA = relationsOf('embedded_items');
const REMOTE_SCHEMA = relationsOf('remote_items');
const FUNCTIONS = generateCatalogFunctionsSQL([
    { databaseName: 'hyper', schemaName: 'public', functionName: 'scale', isAggregate: false, returnType: 'bigint', params: [{ name: 'value', type: 'integer' }] },
]);

/// The query results of a bundle with their bytes
async function resultBytes(bundle: WorkbookBundle): Promise<Array<{ key: string; bytes: Uint8Array }>> {
    return await Promise.all((bundle.results ?? []).map(async ({ key, bytes }) => ({ key, bytes: new Uint8Array(await bytes.arrayBuffer()) })));
}

/// The file names of an archive
async function archiveNames(blob: Blob | ArrayBuffer): Promise<string[]> {
    return Object.keys((await JSZip.loadAsync(blob)).files).sort();
}

/// The compression method of every entry of an archive, 0 is stored and 8 is deflated
async function archiveCompression(blob: Blob): Promise<Record<string, number>> {
    const zip = new ZipReader(new BlobReader(blob));
    try {
        return Object.fromEntries((await zip.getEntries()).map(entry => [entry.filename, entry.compressionMethod]));
    } finally {
        await zip.close();
    }
}

/// The archive of a link
function linkArchive(url: URL): Blob {
    expect(url.searchParams.get('data')).toBeNull();
    return new Blob([BASE64URL_CODEC.decode(url.searchParams.get('zip')!)]);
}

describe('workbook export', () => {
    it('compares data bytes independently of typed-array JSON serialization', () => {
        const bundle = { workbook: testWorkbook(), catalogs: [], scripts: [] };
        const bytes = new Uint8Array([0, 255]);
        const view = new Uint8Array([99, 0, 255, 99]).subarray(1, 3);
        expect(workbookBundlesEqual({ ...bundle, data: [{ name: 'payload.parquet', bytes }] },
            { ...bundle, data: [{ name: 'payload.parquet', bytes: view }] })).toBe(true);
        expect(workbookBundlesEqual({ ...bundle, data: [{ name: 'payload.parquet', bytes }] },
            { ...bundle, data: [{ name: 'payload.parquet', bytes: new Uint8Array([0, 254]) }] })).toBe(false);
        expect(workbookBundlesEqual(bundle, { ...bundle, data: [] })).toBe(true);
    });

    it('writes the workbook tables as Parquet files and the attachments as tables of their own', async () => {
        const bytes = new Uint8Array([0, 255, 128, 195, 40, 13, 10, 0]);
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        await backend.saveDataFile(TEST_WORKBOOK_ID, '2_payload.parquet', bytes);

        const blob = await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend, writer);
        const names = await archiveNames(blob);
        const attachmentTable = names.find(name => name.startsWith('workbook_attachment_'))!;
        expect(names).toEqual([
            attachmentTable,
            'workbook.parquet',
            'workbook_attachments.parquet',
            'workbook_connections.parquet',
            'workbook_scripts.parquet',
        ].sort());
        expect(attachmentTable).toMatch(/^workbook_attachment_[0-9a-f]{32}\.parquet$/);
        expect(await (await JSZip.loadAsync(blob)).file(attachmentTable)!.async('uint8array')).toEqual(bytes);
        // Deflate shrinks the footers of the Parquet files, which Hyper leaves uncompressed
        expect(Object.values(await archiveCompression(blob))).toEqual(names.map(() => 8));

        const target = new WorkbookTestBackend();
        await importWorkbookFromZip(blob, target, database);
        expect(await target.loadDataFile(TEST_WORKBOOK_ID, '2_payload.parquet')).toEqual(bytes);
        expect(await target.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });

    it('imports the archives of older versions, the files of a workbook folder', async () => {
        const bytes = new Uint8Array([0, 255, 128, 195, 40, 13, 10, 0]);
        const input = new JSZip();
        input.file('dashql-workbook.json', JSON.stringify(testWorkbook()));
        input.file('scripts/01_query.sql', 'SELECT 1');
        input.file('attachments/2_payload.parquet', bytes);
        const backend = new WorkbookTestBackend();
        // An archive of an older version is read without the database
        await importWorkbookFromZip(await input.generateAsync({ type: 'blob' }), backend, null);
        expect((await backend.listDataFiles(TEST_WORKBOOK_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: '2_payload.parquet', sizeBytes: bytes.length }]);
        expect(await backend.loadDataFile(TEST_WORKBOOK_ID, '2_payload.parquet')).toEqual(bytes);
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });

    it('needs the database to read the workbook tables', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await expect(readWorkbookBundleFromZip(await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend, writer), null))
            .rejects.toThrow('needs the embedded database');
    });

    it.each(['hyper', 'trino'])('omits %s header credentials from main and attached databases in ZIP and URL exports', async connector => {
        const backend = new WorkbookTestBackend();
        const metadata = { authorization: 'bearer-secret', cookie: 'cookie-secret', 'x-api-key': 'api-secret', arbitrary: 'custom-secret' };
        const params = connector === 'hyper' ? { hyper: {
            protocol: 'V3_HTTP', endpoint: 'https://identity.example',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            metadata, queryParameters: { credential: 'query-secret' },
        } } : { trino: { endpoint: 'https://identity.example', catalogName: 'catalog', metadata } };
        const manifest = testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: params as any }, { connectionId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', params: params as any }),
        });
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, manifest);
        const liveParams = new Map(manifest.connections.map(connection => [connection.connectionId, connection.params]));
        const url = await exportWorkbookAsUrl(backend, writer, TEST_WORKBOOK_ID, liveParams, WorkbookLinkTarget.WEB);
        const archives = [
            await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend, writer),
            await exportWorkbookAsSharedZip(backend, writer, TEST_WORKBOOK_ID, liveParams),
            linkArchive(url),
        ];
        for (const archive of archives) {
            const exported = (await readWorkbookBundleFromZip(archive, database)).workbook;
            const text = JSON.stringify(exported);
            for (const secret of [...Object.values(metadata), 'query-secret']) expect(text).not.toContain(secret);
            for (const connection of exported.connections) {
                expect((connection.params as any)[connector].metadata).toBeUndefined();
                expect((connection.params as any)[connector].queryParameters).toBeUndefined();
                expect((connection.params as any)[connector].endpoint).toBe('https://identity.example');
            }
        }
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections[0].params).toEqual(params);
    });

    it('omits main and attached drafts and secrets from plain and shared ZIP exports', async () => {
        const backend = new WorkbookTestBackend();
        const connection = (connectionId: string) => ({
            connectionId,
            params: { trino: { endpoint: 'https://committed.example', auth: { authType: 'AUTH_BASIC', basic: { username: 'user', secret: 'committed-secret' } } } } as any,
            paramsDraft: { trino: { endpoint: 'unfinished', auth: { authType: 'AUTH_BASIC', basic: { username: 'user', secret: 'draft-secret' } } } } as any,
        });
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(connection(TEST_CONNECTION_ID), connection('bbbbbbbb-cccc-4ddd-8eee-ffffffffffff')),
        }));
        for (const blob of [await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend, writer), await exportWorkbookAsSharedZip(backend, writer, TEST_WORKBOOK_ID, new Map())]) {
            const exported = (await readWorkbookBundleFromZip(blob, database)).workbook;
            const text = JSON.stringify(exported);
            expect(text).not.toContain('paramsDraft');
            expect(text).not.toContain('committed-secret');
            expect(text).not.toContain('draft-secret');
            expect((exported.connections[0].params as any).trino.endpoint).toBe('https://committed.example');
        }
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections[0].paramsDraft).toBeDefined();
    });

    it('does not encode the reserved draft script', async () => {
        const workbook = testWorkbook({ scripts: [{ name: '01_query.sql', connectionId: TEST_CONNECTION_ID }] });
        const blob = await createWorkbookZip(writer, {
            workbook,
            catalogs: [],
            scripts: [{ name: 'dashql-draft.sql', sql: 'SELECT draft' }, { name: '01_query.sql', sql: 'SELECT 1' }],
        });
        expect((await readWorkbookBundleFromZip(blob, database)).scripts).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });

    it('exports the scripts and includes catalogs on request', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', SCHEMA);
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-functions.sql', FUNCTIONS);
        await backend.saveScript(TEST_WORKBOOK_ID, '01_first.sql', 'SELECT 1');
        await backend.saveScript(TEST_WORKBOOK_ID, '02_second.sql', 'SELECT 2');

        const bundle = await readWorkbookBundleFromZip(await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend, writer, { withCatalog: true }), database);
        expect(bundle.scripts).toEqual([{ name: '01_first.sql', sql: 'SELECT 1' }, { name: '02_second.sql', sql: 'SELECT 2' }]);
        expect(bundle.catalogs).toEqual([{ connectionId: TEST_CONNECTION_ID, relations: SCHEMA, functions: FUNCTIONS }]);

        const plain = await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend, writer);
        expect(await archiveNames(plain)).not.toContain('connection_catalog_tables.parquet');
    });

    it('round-trips an archive through import', async () => {
        const source = new WorkbookTestBackend();
        await source.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await source.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 42');
        const target = new WorkbookTestBackend();

        const blob = await exportWorkbookAsZip(TEST_WORKBOOK_ID, source, writer);
        await expect(importWorkbookFromZip(blob, target, database)).resolves.toBe(TEST_WORKBOOK_ID);
        expect(await target.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 42' }]);
    });

    it('carries the query results that a file export asks for, as tables of their own', async () => {
        const source = new WorkbookTestBackend();
        await source.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await source.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 42');
        const key = 'a'.repeat(64);
        const bytes = new Uint8Array([80, 65, 82, 49, 0, 1, 2]);

        // Off by default
        const plain = await exportWorkbookAsSharedZip(source, writer, TEST_WORKBOOK_ID, new Map());
        expect((await archiveNames(plain)).filter(name => name.includes('result'))).toEqual([]);

        const zip = await exportWorkbookAsSharedZip(source, writer, TEST_WORKBOOK_ID, new Map(), { preserveUUIDs: true, queryResults: [{ key, bytes: new Blob([bytes]) }] });
        const names = (await archiveNames(zip)).filter(name => name.includes('result'));
        expect(names).toHaveLength(2);
        expect(names[0]).toMatch(/^workbook_result_[0-9a-f]{32}\.parquet$/);
        expect(names[1]).toBe('workbook_results.parquet');
        // A result stays stored, deflated like the other tables it could not be read in place
        expect((await archiveCompression(zip))[names[0]]).toBe(0);
        expect((await archiveCompression(zip))[names[1]]).toBe(8);
        const zeros = new Uint8Array(64 * 1024);
        const stored = await exportWorkbookAsSharedZip(source, writer, TEST_WORKBOOK_ID, new Map(), { queryResults: [{ key, bytes: new Blob([zeros]) }] });
        expect(stored.size).toBeGreaterThan(zeros.length);
        // An import reads a stored result as a slice of the archive, with the CRC-32 that the archive stores for it
        const imported = await readWorkbookBundleFromZip(zip, database);
        expect(await resultBytes(imported)).toEqual([{ key, bytes }]);
        const crc = new Crc32();
        crc.update(bytes);
        expect(imported.results![0].crc32).toBe(crc.value);
        expect(imported.scripts).toEqual([{ name: '01_query.sql', sql: 'SELECT 42' }]);
        // A result that another tool compressed is inflated
        const archive = await JSZip.loadAsync(zip);
        const deflated = await readWorkbookBundleFromZip(await archive.generateAsync({ type: 'blob', compression: 'DEFLATE' }), database);
        expect(await resultBytes(deflated)).toEqual([{ key, bytes }]);
        // The workbook folder doesn't keep them
        const target = new WorkbookTestBackend();
        await importWorkbookFromZip(zip, target, database);
        expect(await target.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 42' }]);
        expect(await target.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
    });

    it('never carries query results in a link', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const url = await exportWorkbookAsUrl(backend, writer, TEST_WORKBOOK_ID, new Map(), WorkbookLinkTarget.WEB, {
            queryResults: [{ key: 'a'.repeat(64), bytes: new Blob([new Uint8Array([1])]) }],
        });
        expect((await archiveNames(linkArchive(url))).filter(name => name.includes('result'))).toEqual([]);
    });

    it('carries the archive of a link in the zip parameter, base64url-encoded once', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        for (const [target, protocol] of [[WorkbookLinkTarget.WEB, new URL(process.env.DASHQL_APP_URL!).protocol], [WorkbookLinkTarget.NATIVE, 'dashql:']] as const) {
            const url = await exportWorkbookAsUrl(backend, writer, TEST_WORKBOOK_ID, new Map(), target);
            expect(url.protocol).toBe(protocol);
            expect([...url.searchParams.keys()]).toEqual(['zip']);
            const bundle = await readWorkbookBundleFromZip(linkArchive(url), database);
            expect(bundle.workbook.connections).toHaveLength(1);
        }
    });

    it('seeds the connections of an import with the exported catalogs', async () => {
        const source = new WorkbookTestBackend();
        await source.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await source.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', SCHEMA);
        const target = new WorkbookTestBackend();

        await importWorkbookFromZip(await exportWorkbookAsZip(TEST_WORKBOOK_ID, source, writer, { withCatalog: true }), target, database);
        expect([...target.connectionFiles]).toEqual([[`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, SCHEMA]]);
    });

    it('omits catalogs from URL exports by default', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', SCHEMA);
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-functions.sql', FUNCTIONS);

        const url = await exportWorkbookAsUrl(backend, writer, TEST_WORKBOOK_ID, new Map(), WorkbookLinkTarget.WEB);
        expect(await archiveNames(linkArchive(url))).not.toContain('connection_catalog_tables.parquet');
    });

    it('includes the catalogs of all connections in shared ZIP exports by default', async () => {
        const backend = new WorkbookTestBackend();
        const otherConnectionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(testWorkbook().connections[0], { connectionId: otherConnectionId, params: { hyper: {} } as any }),
            scripts: [
                { name: '01_main.sql', connectionId: TEST_CONNECTION_ID },
                { name: '02_other.sql', connectionId: otherConnectionId },
            ],
        }));
        await backend.saveScript(TEST_WORKBOOK_ID, '01_main.sql', 'SELECT 1');
        await backend.saveScript(TEST_WORKBOOK_ID, '02_other.sql', 'SELECT 2');
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', SCHEMA);
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-functions.sql', FUNCTIONS);
        await backend.saveConnectionFile(otherConnectionId, 'dashql-catalog-relations.sql', OTHER_SCHEMA);

        const bundle = await readWorkbookBundleFromZip(await exportWorkbookAsSharedZip(backend, writer, TEST_WORKBOOK_ID, new Map()), database);

        // The catalogs follow the fresh ids of their connections
        const [main, other] = bundle.workbook.connections.map(connection => connection.connectionId);
        expect(main).not.toBe(TEST_CONNECTION_ID);
        expect(bundle.catalogs).toEqual([
            { connectionId: main, relations: SCHEMA, functions: FUNCTIONS },
            { connectionId: other, relations: OTHER_SCHEMA, functions: null },
        ]);
    });

    it('carries only the connections that the scripts use', async () => {
        const backend = new WorkbookTestBackend();
        const otherConnectionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(testWorkbook().connections[0], { connectionId: otherConnectionId, params: { trino: { endpoint: 'https://trino.example' } } as any }),
            scripts: [{ name: '01_remote.sql', connectionId: otherConnectionId }],
        }));
        await backend.saveScript(TEST_WORKBOOK_ID, '01_remote.sql', 'SELECT 1');
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', EMBEDDED_SCHEMA);
        await backend.saveConnectionFile(otherConnectionId, 'dashql-catalog-relations.sql', REMOTE_SCHEMA);

        const bundle = await readWorkbookBundleFromZip(await exportWorkbookAsSharedZip(backend, writer, TEST_WORKBOOK_ID, new Map(), { preserveUUIDs: true }), database);
        // The embedded database that no script uses stays behind with its catalog
        expect(bundle.workbook.connections.map(connection => connection.connectionId)).toEqual([otherConnectionId]);
        expect(bundle.catalogs.map(catalog => catalog.connectionId)).toEqual([otherConnectionId]);
    });

    it('generates new workbook and connection UUIDs for shared exports by default', async () => {
        const backend = new WorkbookTestBackend();
        const otherConnectionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(testWorkbook().connections[0], { connectionId: otherConnectionId, params: { hyper: {} } as any }),
            scripts: [
                { name: '02_attached.sql', connectionId: otherConnectionId },
                { name: '01_attachment.sql', connectionId: TEST_CONNECTION_ID },
            ],
        }));
        await backend.saveScript(TEST_WORKBOOK_ID, '01_attachment.sql', 'SELECT * FROM :payload');
        await backend.saveScript(TEST_WORKBOOK_ID, '02_attached.sql', 'SELECT 2');

        const bundle = await readWorkbookBundleFromZip(await exportWorkbookAsSharedZip(backend, writer, TEST_WORKBOOK_ID, new Map()), database);
        const exported = bundle.workbook;
        // A script names an attachment by its table parameter, whatever the id of the workbook
        expect(bundle.scripts.find(script => script.name === '01_attachment.sql')!.sql).toBe('SELECT * FROM :payload');

        expect(exported.workbookId).not.toBe(TEST_WORKBOOK_ID);
        expect(exported).not.toHaveProperty('defaultConnectionId');
        // The connections follow the scripts in the order the scripts use them
        expect(exported.connections.map(connection => connection.connectionId))
            .toEqual(exported.scripts.map(script => script.connectionId));
        expect(exported.connections[0].connectionId).not.toBe(otherConnectionId);
        expect(exported.connections[1].connectionId).not.toBe(TEST_CONNECTION_ID);
        // The scripts keep their order and follow their connections to the new ids
        expect(exported.scripts).toEqual([
            { name: '02_attached.sql', connectionId: exported.connections[0].connectionId },
            { name: '01_attachment.sql', connectionId: exported.connections[1].connectionId },
        ]);
    });

    it('carries the names of the connections in shared exports', async () => {
        const backend = new WorkbookTestBackend();
        const otherConnectionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(testWorkbook().connections[0], { connectionId: otherConnectionId, params: { hyper: {} } as any }),
            scripts: [
                { name: '01_main.sql', connectionId: TEST_CONNECTION_ID },
                { name: '02_other.sql', connectionId: otherConnectionId },
            ],
        }));
        await backend.saveScript(TEST_WORKBOOK_ID, '01_main.sql', 'SELECT 1');
        await backend.saveScript(TEST_WORKBOOK_ID, '02_other.sql', 'SELECT 2');

        const exported = (await readWorkbookBundleFromZip(await exportWorkbookAsSharedZip(
            backend,
            writer,
            TEST_WORKBOOK_ID,
            new Map(),
            { connectionNames: new Map([[TEST_CONNECTION_ID, 'Production']]) },
        ), database)).workbook;

        // The names follow their connections to the fresh ids, unnamed connections carry none
        expect(exported.connections[0].connectionId).not.toBe(TEST_CONNECTION_ID);
        expect(exported.connections.map(connection => connection.name)).toEqual(['Production', undefined]);
        expect('name' in exported.connections[1]).toBe(false);
    });

    it('preserves workbook and connection UUIDs when requested', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());

        const exported = (await readWorkbookBundleFromZip(await exportWorkbookAsSharedZip(
            backend,
            writer,
            TEST_WORKBOOK_ID,
            new Map(),
            { preserveUUIDs: true },
        ), database)).workbook;

        expect(exported.workbookId).toBe(TEST_WORKBOOK_ID);
        expect(exported.connections[0].connectionId).toBe(TEST_CONNECTION_ID);
    });

    it('generates new UUIDs for URL exports by default', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());

        const url = await exportWorkbookAsUrl(backend, writer, TEST_WORKBOOK_ID, new Map(), WorkbookLinkTarget.WEB);
        const exported = (await readWorkbookBundleFromZip(linkArchive(url), database)).workbook;

        expect(exported.workbookId).not.toBe(TEST_WORKBOOK_ID);
        expect(exported.connections[0].connectionId).not.toBe(TEST_CONNECTION_ID);
    });

    it('shares a connection as an empty workbook that holds only the connection', async () => {
        const metadata = { authorization: 'bearer-secret' };
        const params = { trino: { endpoint: 'https://trino.example', catalogName: 'catalog', metadata } } as any;

        const url = await exportConnectionAsUrl(writer, params, 'Warehouse', WorkbookLinkTarget.WEB);
        const zip = linkArchive(url);
        const exported = (await readWorkbookBundleFromZip(zip, database)).workbook;

        expect(JSON.stringify(exported)).not.toContain('bearer-secret');
        expect(exported.scripts).toEqual([]);
        expect(exported.connections).toHaveLength(1);
        expect(exported.connections[0].name).toBe('Warehouse');
        expect((exported.connections[0].params as any).trino.endpoint).toBe('https://trino.example');

        const target = new WorkbookTestBackend();
        const workbookId = await importWorkbookFromZip(zip, target, database);
        expect(workbookId).toBe(exported.workbookId);
        expect(await target.loadScripts(workbookId)).toEqual([]);
        expect((await target.loadWorkbook(workbookId)).connections.map(connection => connection.connectionId))
            .toEqual([exported.connections[0].connectionId]);
    });
});
