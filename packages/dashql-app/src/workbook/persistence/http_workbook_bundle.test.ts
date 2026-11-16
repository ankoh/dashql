import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@ankoh/dashql';

import type { HttpClient, HttpFetchResult } from '@ankoh/dashql/platform/http_client';
import { readWorkbookFromHttp } from './http_workbook_bundle.js';
import { TEST_CONNECTION_ID, testWorkbook, WorkbookTestBackend } from '@ankoh/dashql/platform/testing/workbook_test_backend';
import { testStorageRuntime } from '@ankoh/dashql/runtime/testing/test_runtime';
import { storageVersions } from '@ankoh/dashql/platform/storage/storage_versions';
import type { WorkbookData } from '@ankoh/dashql/platform/storage/storage_backend';

const URL = new globalThis.URL('https://example.com/workbook/dashql-workbook.json');

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

function response(text: string, status = 200): HttpFetchResult {
    return {
        headers: new Headers(), status, statusText: '',
        text: async () => text,
        json: async () => JSON.parse(text),
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    };
}

/// The metadata of a session of format version 4, before sessions were called workbooks
function v4Session(overrides: Record<string, unknown> = {}) {
    const { scripts: _scripts, attachments: _attachments, connections, workbookId, ...workbook } = testWorkbook();
    const { connectionId, ...database } = connections[0];
    return { ...workbook, sessionId: workbookId, formatVersion: 4, mainDatabase: { databaseId: connectionId, ...database }, attachedDatabases: [], ...overrides };
}

/// The URL of a hosted session of an older version
const SESSION_URL = new globalThis.URL('https://example.com/workbook/dashql-session.json');

function client(files: Record<string, string>): HttpClient {
    return { fetch: vi.fn(async input => {
        const url = input instanceof globalThis.URL ? input : new globalThis.URL(input instanceof Request ? input.url : input);
        return files[url.pathname] == null ? response('', 404) : response(files[url.pathname]);
    }) };
}

/// Read a hosted workbook into a runtime of the test, and write it into the storage of the runtime to look at its files
async function load(url: URL, httpClient: HttpClient, onProgress?: Parameters<typeof readWorkbookFromHttp>[4]) {
    const storage = new WorkbookTestBackend();
    const runtime = testStorageRuntime(dql, storage);
    const result = await readWorkbookFromHttp(url, httpClient, source => runtime.readImport(source), undefined, onProgress);
    const workbook = result.preview.workbook as WorkbookData;
    const outcome = await runtime.commitImport(result.preview.importId, { restore: false });
    return { result, workbook, storage, written: storage.workbooks.get(outcome.workbookId)!, scripts: storage.scripts.get(outcome.workbookId) ?? new Map<string, string>(), data: storage.data.get(outcome.workbookId) ?? new Map() };
}

describe('HTTP workbook folder', () => {
    it('loads listed binary data and refuses unsafe names without fetching them', async () => {
        const bytes = new Uint8Array([0, 255, 128]);
        const httpClient = client({
            '/workbook/dashql-workbook.json': JSON.stringify(testWorkbook({ attachments: [
                { name: '../escape' }, { name: 'payload.parquet' }, { name: 'PAYLOAD.parquet' },
            ] })),
        });
        const fetch = httpClient.fetch;
        httpClient.fetch = vi.fn(async (input, init) => String(input).endsWith('/attachments/payload.parquet')
            ? { ...response(''), arrayBuffer: async () => bytes.buffer }
            : fetch(input, init));
        const { result, data } = await load(URL, httpClient);
        expect([...data.keys()]).toEqual(['payload.parquet']);
        expect(new Uint8Array(data.get('payload.parquet'))).toEqual(bytes);
        expect(result.incomplete).toBe(true);
        expect(vi.mocked(httpClient.fetch).mock.calls.map(call => String(call[0])).some(url => url.includes('escape'))).toBe(false);
    });

    it('loads the listed scripts in their order and reports progress', async () => {
        const progress = vi.fn();
        const { result, workbook, scripts } = await load(URL, client({
            '/workbook/dashql-workbook.json': JSON.stringify(testWorkbook({ scripts: [
                { name: '02_b.sql', connectionId: TEST_CONNECTION_ID },
                { name: '01_a.sql', connectionId: TEST_CONNECTION_ID },
            ] })),
            '/workbook/scripts/01_a.sql': 'SELECT 1',
            '/workbook/scripts/02_b.sql': 'SELECT 2',
        }), progress);

        expect(Object.fromEntries(scripts)).toEqual({ '01_a.sql': 'SELECT 1', '02_b.sql': 'SELECT 2' });
        expect(workbook.scripts.map(script => script.name)).toEqual(['02_b.sql', '01_a.sql']);
        expect(workbook.metadata).toMatchObject({ originType: 'HTTP', originalHttpUrl: URL.toString() });
        expect(result).toMatchObject({ listedScriptCount: 2, loadedScriptCount: 2, incomplete: false });
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
            phase: 'files', completedScriptCount: 2, totalScriptCount: 2,
        }));
    });

    it('marks nested, draft and missing scripts incomplete without fetching unsafe names', async () => {
        const httpClient = client({
            '/workbook/dashql-workbook.json': JSON.stringify(testWorkbook({ scripts: [
                { name: 'page/query.sql', connectionId: TEST_CONNECTION_ID },
                { name: 'dashql-draft.sql', connectionId: TEST_CONNECTION_ID },
                { name: '01_ok.sql', connectionId: TEST_CONNECTION_ID },
                { name: '02_missing.sql', connectionId: TEST_CONNECTION_ID },
            ] })),
            '/workbook/scripts/01_ok.sql': 'SELECT 1',
        });
        const { result, workbook, scripts } = await load(URL, httpClient);
        expect(Object.fromEntries(scripts)).toEqual({ '01_ok.sql': 'SELECT 1' });
        expect(workbook.scripts).toEqual([{ name: '01_ok.sql', connectionId: TEST_CONNECTION_ID }]);
        expect(result.incomplete).toBe(true);
        expect(vi.mocked(httpClient.fetch).mock.calls.map(call => String(call[0])))
            .not.toContain('https://example.com/workbook/scripts/page%2Fquery.sql');
    });

    it('loads a current workbook with the catalogs of its connections without asking for files of older versions', async () => {
        const httpClient = client({
            '/workbook/dashql-workbook.json': JSON.stringify(testWorkbook()),
            [`/workbook/connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`]: 'CREATE TABLE r (a INT)',
        });
        const { result } = await load(URL, httpClient);
        expect(result.incomplete).toBe(false);
        expect(vi.mocked(httpClient.fetch).mock.calls.map(call => new globalThis.URL(String(call[0])).pathname).sort()).toEqual([
            `/workbook/connections/${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`,
            `/workbook/connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`,
            '/workbook/dashql-workbook.json',
        ]);
    });

    it('migrates a remote session of format version 4 with its index', async () => {
        const { result, workbook } = await load(SESSION_URL, client({
            '/workbook/dashql-session.json': JSON.stringify(v4Session()),
            '/workbook/dashql-session-index.json': JSON.stringify({ scripts: [{ name: '10_b.sql' }, { name: '2_a.sql' }] }),
            '/workbook/scripts/2_a.sql': 'SELECT 2',
            '/workbook/scripts/10_b.sql': 'SELECT 10',
        }));
        expect(workbook.formatVersion).toBe(storageVersions().formatVersion);
        // The order of the index is kept, every script runs on the main database
        expect(workbook.scripts).toEqual([
            { name: '10_b.sql', connectionId: TEST_CONNECTION_ID },
            { name: '2_a.sql', connectionId: TEST_CONNECTION_ID },
        ]);
        expect(result).toMatchObject({ listedScriptCount: 2, loadedScriptCount: 2, incomplete: false });
    });

    it('migrates a remote notebook behind a link of an older version', async () => {
        const { sessionId: workbookId, ...workbook } = v4Session({ formatVersion: 2 }) as ReturnType<typeof v4Session> & { sessionId: string };
        const progress = vi.fn();
        const notebookUrl = new globalThis.URL('https://example.com/workbook/dashql-notebook.json');
        const { result, workbook: read, scripts } = await load(notebookUrl, client({
            '/workbook/dashql-notebook.json': JSON.stringify({ ...workbook, notebookId: workbookId }),
            '/workbook/dashql-notebook-index.json': JSON.stringify({ scripts: [{ name: '01_a.sql' }] }),
            '/workbook/dashql-relations.sql': 'CREATE TABLE r (a INT)',
            '/workbook/dashql-functions.sql': 'CREATE FUNCTION f() RETURNS INT',
            '/workbook/scripts/01_a.sql': 'SELECT 1',
        }), progress);
        expect(read).toMatchObject({ formatVersion: storageVersions().formatVersion, workbookId });
        expect(read).not.toHaveProperty('notebookId');
        expect(read.metadata.originalHttpUrl).toBe(notebookUrl.toString());
        expect(Object.fromEntries(scripts)).toEqual({ '01_a.sql': 'SELECT 1' });
        expect(result).toMatchObject({ listedScriptCount: 1, loadedScriptCount: 1, incomplete: false });
        // The workbook file and the script
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'files', completedFileCount: 2, totalFileCount: 2 }));
    });

    it('refuses a remote workbook of a newer version', async () => {
        await expect(load(URL, client({
            '/workbook/dashql-workbook.json': JSON.stringify({ ...testWorkbook(), formatVersion: storageVersions().formatVersion + 1 }),
        }))).rejects.toThrow('Unsupported workbook format version');
    });

    it('refuses a URL that does not name the workbook metadata', async () => {
        await expect(load(new globalThis.URL('https://example.com/workbook/other.json'), client({})))
            .rejects.toThrow('Remote workbook URL must end in dashql-workbook.json');
    });

    it('strictly refuses a remote V1 workbook', async () => {
        await expect(load(URL, client({
            '/workbook/dashql-workbook.json': JSON.stringify({ ...testWorkbook(), formatVersion: 1 }),
        }))).rejects.toThrow('Unsupported workbook format version');
    });
});
