import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpFetchResult } from '@ankoh/dashql-runtime/platform/http/http_client';
import { readWorkbookBundleFromHttp } from './http_workbook_bundle.js';
import { TEST_CONNECTION_ID, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { WORKBOOK_FORMAT_VERSION } from '@ankoh/dashql-runtime/storage/migration/versions';

const URL = new globalThis.URL('https://example.com/workbook/dashql-workbook.json');

function response(text: string, status = 200): HttpFetchResult {
    return {
        headers: new Headers(), status, statusText: '',
        text: async () => text,
        json: async () => JSON.parse(text),
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    };
}

/// A workbook file of format version 4, it references a main database and lists no scripts
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

describe('HTTP workbook bundle', () => {
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
        const result = await readWorkbookBundleFromHttp(URL, httpClient);
        expect(result.bundle.data).toEqual([{ name: 'payload.parquet', bytes }]);
        expect(result.incomplete).toBe(true);
        expect(vi.mocked(httpClient.fetch).mock.calls.map(call => String(call[0])).some(url => url.includes('escape'))).toBe(false);
    });
    it('loads the listed scripts in their order and reports progress', async () => {
        const progress = vi.fn();
        const result = await readWorkbookBundleFromHttp(URL, client({
            '/workbook/dashql-workbook.json': JSON.stringify(testWorkbook({ scripts: [
                { name: '02_b.sql', connectionId: TEST_CONNECTION_ID },
                { name: '01_a.sql', connectionId: TEST_CONNECTION_ID },
            ] })),
            '/workbook/scripts/01_a.sql': 'SELECT 1',
            '/workbook/scripts/02_b.sql': 'SELECT 2',
        }), undefined, progress);

        expect(result.bundle.scripts).toEqual([
            { name: '02_b.sql', sql: 'SELECT 2' },
            { name: '01_a.sql', sql: 'SELECT 1' },
        ]);
        expect(result.bundle.workbook.scripts.map(script => script.name)).toEqual(['02_b.sql', '01_a.sql']);
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
        const result = await readWorkbookBundleFromHttp(URL, httpClient);
        expect(result.bundle.scripts).toEqual([{ name: '01_ok.sql', sql: 'SELECT 1' }]);
        expect(result.bundle.workbook.scripts).toEqual([{ name: '01_ok.sql', connectionId: TEST_CONNECTION_ID }]);
        expect(result.incomplete).toBe(true);
        expect(vi.mocked(httpClient.fetch).mock.calls.map(call => String(call[0])))
            .not.toContain('https://example.com/workbook/scripts/page%2Fquery.sql');
    });

    it('loads a current workbook with the catalogs of its connections without asking for files of older versions', async () => {
        const httpClient = client({
            '/workbook/dashql-workbook.json': JSON.stringify(testWorkbook()),
            [`/workbook/connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`]: 'CREATE TABLE r (a INT)',
        });
        const result = await readWorkbookBundleFromHttp(URL, httpClient);
        expect(result.bundle.catalogs).toEqual([{ connectionId: TEST_CONNECTION_ID, relations: 'CREATE TABLE r (a INT)', functions: null }]);
        expect(result.incomplete).toBe(false);
        expect(vi.mocked(httpClient.fetch).mock.calls.map(call => new globalThis.URL(String(call[0])).pathname).sort()).toEqual([
            `/workbook/connections/${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`,
            `/workbook/connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`,
            '/workbook/dashql-workbook.json',
        ]);
    });

    it('migrates a remote session of format version 4 with its index', async () => {
        const result = await readWorkbookBundleFromHttp(SESSION_URL, client({
            '/workbook/dashql-session.json': JSON.stringify(v4Session()),
            '/workbook/dashql-session-index.json': JSON.stringify({ scripts: [{ name: '10_b.sql' }, { name: '2_a.sql' }] }),
            '/workbook/scripts/2_a.sql': 'SELECT 2',
            '/workbook/scripts/10_b.sql': 'SELECT 10',
        }));
        expect(result.bundle.workbook.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
        // The order of the index is kept, every script runs on the main database
        expect(result.bundle.workbook.scripts).toEqual([
            { name: '10_b.sql', connectionId: TEST_CONNECTION_ID },
            { name: '2_a.sql', connectionId: TEST_CONNECTION_ID },
        ]);
        expect(result).toMatchObject({ listedScriptCount: 2, loadedScriptCount: 2, incomplete: false });
    });

    it('migrates a remote session of format version 3', async () => {
        const result = await readWorkbookBundleFromHttp(SESSION_URL, client({
            '/workbook/dashql-session.json': JSON.stringify(v4Session({ formatVersion: 3 })),
            '/workbook/dashql-session-index.json': JSON.stringify({ scripts: [] }),
            '/workbook/dashql-catalog-relations.sql': 'CREATE TABLE r (a INT)',
        }));
        expect(result.bundle.workbook.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
        // The catalog copy of older workbooks is the catalog of the default connection
        expect(result.bundle.catalogs).toEqual([{ connectionId: TEST_CONNECTION_ID, relations: 'CREATE TABLE r (a INT)', functions: null }]);
    });

    it('migrates a remote notebook behind a link of an older version', async () => {
        const { sessionId: workbookId, ...workbook } = v4Session({ formatVersion: 2 }) as ReturnType<typeof v4Session> & { sessionId: string };
        const progress = vi.fn();
        const notebookUrl = new globalThis.URL('https://example.com/workbook/dashql-notebook.json');
        const result = await readWorkbookBundleFromHttp(notebookUrl, client({
            '/workbook/dashql-notebook.json': JSON.stringify({ ...workbook, notebookId: workbookId }),
            '/workbook/dashql-notebook-index.json': JSON.stringify({ scripts: [{ name: '01_a.sql' }] }),
            '/workbook/dashql-relations.sql': 'CREATE TABLE r (a INT)',
            '/workbook/dashql-functions.sql': 'CREATE FUNCTION f() RETURNS INT',
            '/workbook/scripts/01_a.sql': 'SELECT 1',
        }), undefined, progress);
        expect(result.bundle.workbook).toMatchObject({ formatVersion: WORKBOOK_FORMAT_VERSION, workbookId });
        expect(result.bundle.workbook).not.toHaveProperty('notebookId');
        expect(result.bundle.workbook.metadata.originalHttpUrl).toBe(notebookUrl.toString());
        expect(result.bundle.catalogs).toEqual([{ connectionId: TEST_CONNECTION_ID, relations: 'CREATE TABLE r (a INT)', functions: 'CREATE FUNCTION f() RETURNS INT' }]);
        expect(result.bundle.scripts).toEqual([{ name: '01_a.sql', sql: 'SELECT 1' }]);
        expect(result).toMatchObject({ listedScriptCount: 1, loadedScriptCount: 1, incomplete: false });
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'files', completedFileCount: 4, totalFileCount: 4 }));
    });

    it('refuses a remote workbook of a newer version', async () => {
        await expect(readWorkbookBundleFromHttp(URL, client({
            '/workbook/dashql-workbook.json': JSON.stringify({ ...testWorkbook(), formatVersion: WORKBOOK_FORMAT_VERSION + 1 }),
        }))).rejects.toThrow('Unsupported workbook format version');
    });

    it('refuses a URL that does not name the workbook metadata', async () => {
        await expect(readWorkbookBundleFromHttp(new globalThis.URL('https://example.com/workbook/other.json'), client({})))
            .rejects.toThrow('Remote workbook URL must end in dashql-workbook.json');
    });

    it('strictly refuses a remote V1 workbook', async () => {
        await expect(readWorkbookBundleFromHttp(URL, client({
            '/workbook/dashql-workbook.json': JSON.stringify({ ...testWorkbook(), formatVersion: 1 }),
        }))).rejects.toThrow('Unsupported workbook format version');
    });
});
