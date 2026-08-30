import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpFetchResult } from '../../../platform/http/http_client.js';
import { readNotebookBundleFromHttp } from './http_notebook_bundle.js';

const MANIFEST_URL = new URL('https://owner.github.io/notebooks/example/dashql-notebook.json');
const NOTEBOOK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function response(text: string, status = 200): HttpFetchResult {
    return {
        headers: new Headers({ 'content-length': String(new TextEncoder().encode(text).byteLength) }),
        status,
        statusText: status === 200 ? 'OK' : 'Not Found',
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
        json: async () => JSON.parse(text),
        text: async () => text,
    };
}

function client(files: Record<string, string>): { httpClient: HttpClient; fetch: ReturnType<typeof vi.fn> } {
    const fetch = vi.fn(async (input: URL | Request | string) => {
        const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
        const body = files[url.pathname];
        return body == null ? response('', 404) : response(body);
    });
    return { httpClient: { fetch }, fetch };
}

describe('readNotebookBundleFromHttp', () => {
    it('loads the indexed tree and optional fixed files', async () => {
        const { httpClient, fetch } = client({
            '/notebooks/example/dashql-notebook.json': JSON.stringify({
                notebookId: NOTEBOOK_ID,
                name: 'Published',
                connectionParams: { hyper: {} },
                metadata: { createdAt: '2026-01-01T00:00:00Z' },
            }),
            '/notebooks/example/dashql-notebook-index.json': JSON.stringify({
                folders: [
                    { name: '1_main', scripts: [{ name: '1_query.sql' }] },
                    { name: '2_empty', scripts: [] },
                ],
            }),
            '/notebooks/example/dashql-relations.sql': 'CREATE TABLE example(id int);',
            '/notebooks/example/scripts/dashql-draft.sql': 'SELECT draft;',
            '/notebooks/example/scripts/1_main/1_query.sql': 'SELECT 1;',
        });

        await expect(readNotebookBundleFromHttp(MANIFEST_URL, httpClient)).resolves.toEqual({
            bundle: {
                notebook: {
                    notebookId: NOTEBOOK_ID,
                    name: 'Published',
                    connectionParams: { hyper: {} },
                    metadata: {
                        createdAt: '2026-01-01T00:00:00Z',
                        originType: 'HTTP',
                        originalHttpUrl: MANIFEST_URL.toString(),
                    },
                },
                schemaSql: 'CREATE TABLE example(id int);',
                functionsSql: null,
                folders: [
                    { name: '1_main', scripts: [{ name: '1_query.sql', sql: 'SELECT 1;' }] },
                    { name: '2_empty', scripts: [] },
                ],
                draftSql: 'SELECT draft;',
            },
            indexedScriptCount: 1,
            loadedScriptCount: 1,
            incomplete: false,
        });
        expect(fetch).toHaveBeenCalledTimes(6);
    });

    it('reports manifest, index, and file progress', async () => {
        const { httpClient } = client({
            '/notebooks/example/dashql-notebook.json': JSON.stringify({
                notebookId: NOTEBOOK_ID,
                name: 'Published',
                connectionParams: { hyper: {} },
                metadata: {},
            }),
            '/notebooks/example/dashql-notebook-index.json': JSON.stringify({
                folders: [{ name: 'main', scripts: [{ name: 'query.sql' }] }],
            }),
            '/notebooks/example/scripts/main/query.sql': 'SELECT 1;',
        });
        const progress = vi.fn();

        await readNotebookBundleFromHttp(MANIFEST_URL, httpClient, undefined, progress);

        expect(progress.mock.calls[0][0]).toEqual({ phase: 'manifest' });
        expect(progress.mock.calls[1][0]).toEqual({
            phase: 'index',
            notebookName: 'Published',
            notebookId: NOTEBOOK_ID,
        });
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({
            phase: 'files',
            completedFileCount: 2,
            totalFileCount: 6,
            completedScriptCount: 0,
            totalScriptCount: 1,
        }));
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
            phase: 'files',
            completedFileCount: 6,
            completedScriptCount: 1,
        }));
    });

    it('ignores unsafe and duplicate stale index entries', async () => {
        const { httpClient, fetch } = client({
            '/example/dashql-notebook.json': JSON.stringify({
                notebookId: NOTEBOOK_ID,
                connectionParams: { hyper: {} },
                metadata: {},
            }),
            '/example/dashql-notebook-index.json': JSON.stringify({
                folders: [
                    { name: '..', scripts: [{ name: 'query.sql' }] },
                    {
                        name: 'main',
                        scripts: [
                            { name: '../query.sql' },
                            { name: 'query.sql' },
                            { name: 'QUERY.SQL' },
                            { invalid: true },
                        ],
                    },
                    { name: 'MAIN', scripts: [{ name: 'other.sql' }] },
                ],
            }),
        });

        await expect(readNotebookBundleFromHttp(
            new URL('https://example.com/example/dashql-notebook.json'),
            httpClient,
        )).resolves.toEqual(expect.objectContaining({
            bundle: expect.objectContaining({ folders: [{ name: 'main', scripts: [] }] }),
            incomplete: true,
        }));
        expect(fetch).toHaveBeenCalledTimes(6);
        await expect(readNotebookBundleFromHttp(
            new URL('http://example.com/example/dashql-notebook.json'),
            httpClient,
        )).rejects.toThrow('public HTTPS, development loopback HTTP, or a bundled app URL');
    });

    it('treats every failure outside dashql-notebook.json as optional', async () => {
        const manifest = JSON.stringify({
            notebookId: NOTEBOOK_ID,
            connectionParams: { hyper: {} },
            metadata: {},
        });
        const fetch = vi.fn(async (input: URL | Request | string) => {
            const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
            if (url.pathname.endsWith('dashql-notebook.json')) return response(manifest);
            if (url.pathname.endsWith('dashql-notebook-index.json')) return response('{"folders":[]}');
            if (url.pathname.endsWith('dashql-functions.sql')) return response('failure', 500);
            return response('', 404);
        });

        await expect(readNotebookBundleFromHttp(MANIFEST_URL, { fetch })).resolves.toEqual(expect.objectContaining({
            bundle: expect.objectContaining({
                schemaSql: null,
                functionsSql: null,
                folders: [],
                draftSql: null,
            }),
        }));
    });

    it('loads a metadata-only notebook when the index is missing or malformed', async () => {
        const manifest = JSON.stringify({
            notebookId: NOTEBOOK_ID,
            connectionParams: { hyper: {} },
            metadata: {},
        });
        for (const index of [null, 'not json']) {
            const files: Record<string, string> = {
                '/notebooks/example/dashql-notebook.json': manifest,
            };
            if (index != null) files['/notebooks/example/dashql-notebook-index.json'] = index;

            await expect(readNotebookBundleFromHttp(MANIFEST_URL, client(files).httpClient))
                .resolves.toEqual(expect.objectContaining({
                    bundle: expect.objectContaining({
                        folders: [],
                        schemaSql: null,
                        functionsSql: null,
                        draftSql: null,
                    }),
                    incomplete: true,
                }));
        }
    });

    it('omits missing files referenced by a stale index while retaining the folder', async () => {
        const { httpClient } = client({
            '/notebooks/example/dashql-notebook.json': JSON.stringify({
                notebookId: NOTEBOOK_ID,
                connectionParams: { hyper: {} },
                metadata: {},
            }),
            '/notebooks/example/dashql-notebook-index.json': JSON.stringify({
                folders: [{
                    name: 'main',
                    scripts: [{ name: 'present.sql' }, { name: 'deleted.sql' }],
                }],
            }),
            '/notebooks/example/scripts/main/present.sql': 'SELECT 1;',
        });

        await expect(readNotebookBundleFromHttp(MANIFEST_URL, httpClient)).resolves.toEqual(expect.objectContaining({
            bundle: expect.objectContaining({
                folders: [{ name: 'main', scripts: [{ name: 'present.sql', sql: 'SELECT 1;' }] }],
            }),
            indexedScriptCount: 2,
            loadedScriptCount: 1,
            incomplete: true,
        }));
    });

    it('still fails when dashql-notebook.json is unavailable', async () => {
        await expect(readNotebookBundleFromHttp(MANIFEST_URL, client({}).httpClient))
            .rejects.toThrow('dashql-notebook.json: HTTP 404');
    });

    it('allows loopback HTTP while running the development build', async () => {
        const manifestUrl = new URL('http://localhost:9002/static/examples/notebooks/example/dashql-notebook.json');
        const { httpClient } = client({
            '/static/examples/notebooks/example/dashql-notebook.json': JSON.stringify({
                notebookId: NOTEBOOK_ID,
                connectionParams: { hyper: {} },
                metadata: {},
            }),
            '/static/examples/notebooks/example/dashql-notebook-index.json': '{"folders":[]}',
        });

        await expect(readNotebookBundleFromHttp(manifestUrl, httpClient)).resolves.toEqual(expect.objectContaining({
            bundle: expect.objectContaining({
                notebook: expect.objectContaining({ notebookId: NOTEBOOK_ID }),
            }),
        }));
    });

    it('loads notebook files from the packaged app origin', async () => {
        const { httpClient } = client({
            '/static/examples/notebooks/example/dashql-notebook.json': JSON.stringify({
                notebookId: NOTEBOOK_ID,
                connectionParams: { hyper: {} },
                metadata: {},
            }),
            '/static/examples/notebooks/example/dashql-notebook-index.json': '{"folders":[]}',
        });

        const result = await readNotebookBundleFromHttp(
            new URL('app://bundle/static/examples/notebooks/example/dashql-notebook.json'),
            httpClient,
        );
        expect(result.bundle.notebook.metadata?.originalHttpUrl)
            .toBe('app://bundle/static/examples/notebooks/example/dashql-notebook.json');
    });
});
