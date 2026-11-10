import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

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
import type { WorkbookData } from '../../storage/storage_backend.js';

/// The query results of a bundle with their bytes
async function resultBytes(bundle: WorkbookBundle): Promise<Array<{ key: string; bytes: Uint8Array }>> {
    return await Promise.all((bundle.results ?? []).map(async ({ key, bytes }) => ({ key, bytes: new Uint8Array(await bytes.arrayBuffer()) })));
}

describe('V2 workbook export', () => {
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
    it('persists arbitrary binary data and round-trips it through a ZIP', async () => {
        const bytes = new Uint8Array([0, 255, 128, 195, 40, 13, 10, 0]);
        const input = new JSZip();
        input.file('dashql-workbook.json', JSON.stringify(testWorkbook()));
        input.file('attachments/2_payload.parquet', bytes);
        const backend = new WorkbookTestBackend();
        await importWorkbookFromZip(await input.generateAsync({ type: 'blob' }), backend);
        expect((await backend.listDataFiles(TEST_WORKBOOK_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: '2_payload.parquet', sizeBytes: bytes.length }]);
        expect(await backend.loadDataFile(TEST_WORKBOOK_ID, '2_payload.parquet')).toEqual(bytes);

        const archive = await JSZip.loadAsync(await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend));
        expect(archive.file('attachments/2_payload.parquet')).not.toBeNull();
        expect(await archive.file('attachments/2_payload.parquet')!.async('uint8array')).toEqual(bytes);
        const target = new WorkbookTestBackend();
        await importWorkbookFromZip(await archive.generateAsync({ type: 'blob' }), target);
        expect(await target.loadDataFile(TEST_WORKBOOK_ID, '2_payload.parquet')).toEqual(bytes);
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
        const url = await exportWorkbookAsUrl(backend, TEST_WORKBOOK_ID, liveParams, WorkbookLinkTarget.WEB);
        const event = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(url.searchParams.get('data')!)));
        const archives = [
            await JSZip.loadAsync(await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend)),
            await JSZip.loadAsync(await exportWorkbookAsSharedZip(backend, TEST_WORKBOOK_ID, liveParams)),
            await JSZip.loadAsync(BASE64URL_CODEC.decode(event.session)),
        ];
        for (const archive of archives) {
            const text = await archive.file('dashql-workbook.json')!.async('text');
            for (const secret of [...Object.values(metadata), 'query-secret']) expect(text).not.toContain(secret);
            const exported = JSON.parse(text);
            for (const database of exported.connections) {
                expect(database.params[connector].metadata).toBeUndefined();
                expect(database.params[connector].queryParameters).toBeUndefined();
                expect(database.params[connector].endpoint).toBe('https://identity.example');
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
        for (const blob of [await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend), await exportWorkbookAsSharedZip(backend, TEST_WORKBOOK_ID, new Map())]) {
            const archive = await JSZip.loadAsync(blob);
            const text = await archive.file('dashql-workbook.json')!.async('text');
            expect(text).not.toContain('paramsDraft');
            expect(text).not.toContain('committed-secret');
            expect(text).not.toContain('draft-secret');
            expect(JSON.parse(text).connections[0].params.trino.endpoint).toBe('https://committed.example');
        }
        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).connections[0].paramsDraft).toBeDefined();
    });
    it('does not encode the reserved draft script', async () => {
        const archive = await JSZip.loadAsync(await createWorkbookZip(testWorkbook(), [
            { name: 'dashql-draft.sql', sql: 'SELECT draft' },
            { name: '01_query.sql', sql: 'SELECT 1' },
        ]));

        expect(archive.file('scripts/dashql-draft.sql')).toBeNull();
        expect(await archive.file('scripts/01_query.sql')!.async('text')).toBe('SELECT 1');
    });

    it('exports only flat scripts and includes catalogs on request', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', 'schema');
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-functions.sql', 'functions');
        await backend.saveScript(TEST_WORKBOOK_ID, '01_first.sql', 'SELECT 1');
        await backend.saveScript(TEST_WORKBOOK_ID, '02_second.sql', 'SELECT 2');

        const archive = await JSZip.loadAsync(await exportWorkbookAsZip(TEST_WORKBOOK_ID, backend, { withCatalog: true }));
        expect(await archive.file('scripts/01_first.sql')!.async('text')).toBe('SELECT 1');
        expect(await archive.file('scripts/02_second.sql')!.async('text')).toBe('SELECT 2');
        expect(await archive.file(`connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)!.async('text')).toBe('schema');
        expect(await archive.file(`connections/${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`)!.async('text')).toBe('functions');
        expect(archive.file(/scripts\/[^/]+\/[^/]+/)).toEqual([]);
        expect(archive.file('scripts/dashql-draft.sql')).toBeNull();
    });

    it('round-trips a flat V2 archive through import', async () => {
        const source = new WorkbookTestBackend();
        await source.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await source.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 42');
        const target = new WorkbookTestBackend();

        const blob = await exportWorkbookAsZip(TEST_WORKBOOK_ID, source);
        await expect(importWorkbookFromZip(blob, target)).resolves.toBe(TEST_WORKBOOK_ID);
        expect(await target.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 42' }]);
    });

    it('carries the query results that a file export asks for, named after their keys', async () => {
        const source = new WorkbookTestBackend();
        await source.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await source.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 42');
        const key = 'a'.repeat(64);
        const bytes = new Uint8Array([80, 65, 82, 49, 0, 1, 2]);

        // Off by default
        const plain = await JSZip.loadAsync(await exportWorkbookAsSharedZip(source, TEST_WORKBOOK_ID, new Map()));
        expect(plain.file(/^results\//)).toEqual([]);

        const zip = await exportWorkbookAsSharedZip(source, TEST_WORKBOOK_ID, new Map(), { preserveUUIDs: true, queryResults: [{ key, bytes: new Blob([bytes]) }] });
        const archive = await JSZip.loadAsync(zip);
        expect(archive.file(/^results\//).map(file => file.name)).toEqual([`results/${key}.parquet`]);
        expect(await archive.file(`results/${key}.parquet`)!.async('uint8array')).toEqual(bytes);
        // Parquet is compressed already, the archive stores it as it is
        const zeros = new Uint8Array(64 * 1024);
        const stored = await exportWorkbookAsSharedZip(source, TEST_WORKBOOK_ID, new Map(), { queryResults: [{ key, bytes: new Blob([zeros]) }] });
        expect(stored.size).toBeGreaterThan(zeros.length);
        // An import reads a stored result as a slice of the archive, with the CRC-32 that the archive stores for it
        const imported = await readWorkbookBundleFromZip(zip);
        expect(await resultBytes(imported)).toEqual([{ key, bytes }]);
        const crc = new Crc32();
        crc.update(bytes);
        expect(imported.results![0].crc32).toBe(crc.value);
        // Other files of the folder and files with other names are left out of an import
        archive.file('results/notes.txt', 'x');
        archive.file(`results/${'B'.repeat(64)}.parquet`, bytes);
        archive.file(`results/nested/${'c'.repeat(64)}.parquet`, bytes);
        const bundle = await readWorkbookBundleFromZip(await archive.generateAsync({ type: 'blob' }));
        expect(await resultBytes(bundle)).toEqual([{ key, bytes }]);
        expect(bundle.scripts).toEqual([{ name: '01_query.sql', sql: 'SELECT 42' }]);
        // A result that another tool compressed is inflated
        const deflated = await readWorkbookBundleFromZip(await archive.generateAsync({ type: 'blob', compression: 'DEFLATE' }));
        expect(await resultBytes(deflated)).toEqual([{ key, bytes }]);
        // The workbook folder doesn't keep them
        const target = new WorkbookTestBackend();
        await importWorkbookFromZip(zip, target);
        expect(await target.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 42' }]);
        expect(await target.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
    });

    it('never carries query results in a link', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const url = await exportWorkbookAsUrl(backend, TEST_WORKBOOK_ID, new Map(), WorkbookLinkTarget.WEB, {
            queryResults: [{ key: 'a'.repeat(64), bytes: new Blob([new Uint8Array([1])]) }],
        });
        const event = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(url.searchParams.get('data')!))) as { session: string };
        const archive = await JSZip.loadAsync(BASE64URL_CODEC.decode(event.session));
        expect(archive.file(/^results\//)).toEqual([]);
    });

    it('seeds the connections of an import with the exported catalogs', async () => {
        const source = new WorkbookTestBackend();
        await source.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await source.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', 'schema');
        const target = new WorkbookTestBackend();

        await importWorkbookFromZip(await exportWorkbookAsZip(TEST_WORKBOOK_ID, source, { withCatalog: true }), target);
        expect([...target.connectionFiles]).toEqual([[`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, 'schema']]);
    });

    it('omits catalogs from URL exports by default', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', 'schema');
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-functions.sql', 'functions');

        const url = await exportWorkbookAsUrl(backend, TEST_WORKBOOK_ID, new Map(), WorkbookLinkTarget.WEB);
        const eventJson = new TextDecoder().decode(BASE64URL_CODEC.decode(url.searchParams.get('data')!));
        const event = JSON.parse(eventJson) as { session: string };
        const archive = await JSZip.loadAsync(BASE64URL_CODEC.decode(event.session));

        expect(archive.file(/^connections\//)).toEqual([]);
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
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', 'schema');
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-functions.sql', 'functions');
        await backend.saveConnectionFile(otherConnectionId, 'dashql-catalog-relations.sql', 'other');

        const archive = await JSZip.loadAsync(await exportWorkbookAsSharedZip(
            backend,
            TEST_WORKBOOK_ID,
            new Map(),
        ));

        // The catalogs follow the fresh ids of their connections
        const workbook = JSON.parse(await archive.file('dashql-workbook.json')!.async('text')) as WorkbookData;
        const [main, other] = workbook.connections.map(connection => connection.connectionId);
        expect(main).not.toBe(TEST_CONNECTION_ID);
        expect(await archive.file(`connections/${main}/dashql-catalog-relations.sql`)!.async('text')).toBe('schema');
        expect(await archive.file(`connections/${main}/dashql-catalog-functions.sql`)!.async('text')).toBe('functions');
        expect(await archive.file(`connections/${other}/dashql-catalog-relations.sql`)!.async('text')).toBe('other');
        expect(archive.file(/^connections\//)).toHaveLength(3);
    });

    it('carries only the connections that the scripts use', async () => {
        const backend = new WorkbookTestBackend();
        const otherConnectionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(testWorkbook().connections[0], { connectionId: otherConnectionId, params: { trino: { endpoint: 'https://trino.example' } } as any }),
            scripts: [{ name: '01_remote.sql', connectionId: otherConnectionId }],
        }));
        await backend.saveScript(TEST_WORKBOOK_ID, '01_remote.sql', 'SELECT 1');
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-relations.sql', 'embedded');
        await backend.saveConnectionFile(otherConnectionId, 'dashql-catalog-relations.sql', 'remote');

        const archive = await JSZip.loadAsync(await exportWorkbookAsSharedZip(backend, TEST_WORKBOOK_ID, new Map(), { preserveUUIDs: true }));
        const exported = JSON.parse(await archive.file('dashql-workbook.json')!.async('text')) as WorkbookData;
        // The embedded database that no script uses stays behind with its catalog
        expect(exported.connections.map(connection => connection.connectionId)).toEqual([otherConnectionId]);
        expect(archive.file(/^connections\//).map(file => file.name)).toEqual([`connections/${otherConnectionId}/dashql-catalog-relations.sql`]);
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

        const archive = await JSZip.loadAsync(await exportWorkbookAsSharedZip(
            backend,
            TEST_WORKBOOK_ID,
            new Map(),
        ));
        const exported = JSON.parse(await archive.file('dashql-workbook.json')!.async('text'));
        // A script names an attachment by its table parameter, whatever the id of the workbook
        expect(await archive.file('scripts/01_attachment.sql')!.async('text')).toBe('SELECT * FROM :payload');

        expect(exported.workbookId).not.toBe(TEST_WORKBOOK_ID);
        expect(exported).not.toHaveProperty('defaultConnectionId');
        // The connections follow the scripts in the order the scripts use them
        expect(exported.connections.map((connection: { connectionId: string }) => connection.connectionId))
            .toEqual(exported.scripts.map((script: { connectionId: string }) => script.connectionId));
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

        const archive = await JSZip.loadAsync(await exportWorkbookAsSharedZip(
            backend,
            TEST_WORKBOOK_ID,
            new Map(),
            { connectionNames: new Map([[TEST_CONNECTION_ID, 'Production']]) },
        ));
        const exported = JSON.parse(await archive.file('dashql-workbook.json')!.async('text')) as WorkbookData;

        // The names follow their connections to the fresh ids, unnamed connections carry none
        expect(exported.connections[0].connectionId).not.toBe(TEST_CONNECTION_ID);
        expect(exported.connections.map(connection => connection.name)).toEqual(['Production', undefined]);
        expect('name' in exported.connections[1]).toBe(false);
    });

    it('preserves workbook and connection UUIDs when requested', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());

        const archive = await JSZip.loadAsync(await exportWorkbookAsSharedZip(
            backend,
            TEST_WORKBOOK_ID,
            new Map(),
            { preserveUUIDs: true },
        ));
        const exported = JSON.parse(await archive.file('dashql-workbook.json')!.async('text'));

        expect(exported.workbookId).toBe(TEST_WORKBOOK_ID);
        expect(exported.connections[0].connectionId).toBe(TEST_CONNECTION_ID);
    });

    it('generates new UUIDs for URL exports by default', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());

        const url = await exportWorkbookAsUrl(backend, TEST_WORKBOOK_ID, new Map(), WorkbookLinkTarget.WEB);
        const eventJson = new TextDecoder().decode(BASE64URL_CODEC.decode(url.searchParams.get('data')!));
        const event = JSON.parse(eventJson) as { session: string };
        const archive = await JSZip.loadAsync(BASE64URL_CODEC.decode(event.session));
        const exported = JSON.parse(await archive.file('dashql-workbook.json')!.async('text'));

        expect(exported.workbookId).not.toBe(TEST_WORKBOOK_ID);
        expect(exported.defaultConnectionId).not.toBe(TEST_CONNECTION_ID);
    });

    it('shares a connection as an empty workbook that holds only the connection', async () => {
        const metadata = { authorization: 'bearer-secret' };
        const params = { trino: { endpoint: 'https://trino.example', catalogName: 'catalog', metadata } } as any;

        const url = await exportConnectionAsUrl(params, 'Warehouse', WorkbookLinkTarget.WEB);
        const eventJson = new TextDecoder().decode(BASE64URL_CODEC.decode(url.searchParams.get('data')!));
        const event = JSON.parse(eventJson) as { session: string };
        const zip = BASE64URL_CODEC.decode(event.session);
        const archive = await JSZip.loadAsync(zip);
        const text = await archive.file('dashql-workbook.json')!.async('text');
        const exported = JSON.parse(text) as WorkbookData;

        expect(text).not.toContain('bearer-secret');
        expect(exported.scripts).toEqual([]);
        expect(exported.connections).toHaveLength(1);
        expect(exported.connections[0].name).toBe('Warehouse');
        expect((exported.connections[0].params as any).trino.endpoint).toBe('https://trino.example');

        const target = new WorkbookTestBackend();
        const workbookId = await importWorkbookFromZip(new Blob([zip]), target);
        expect(workbookId).toBe(exported.workbookId);
        expect(await target.loadScripts(workbookId)).toEqual([]);
        expect((await target.loadWorkbook(workbookId)).connections.map(connection => connection.connectionId))
            .toEqual([exported.connections[0].connectionId]);
    });
});
