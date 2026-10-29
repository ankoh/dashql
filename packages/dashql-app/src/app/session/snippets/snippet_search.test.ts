import * as dashql from '@ankoh/dashql-core';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestHyperDBClient, testDatabasePath } from '../../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, type HyperDBClient } from '../../../platform/hyperdb/hyperdb_wasm.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { buildSnippetRegistry, getBundledSnippets, snippetsForConnector, type SnippetRegistry } from './snippet_registry.js';
import { SnippetSearch, snippetSearchPattern } from './snippet_search.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

function file(description: string, body: string): string {
    return `${dashql.renderCommentTag('description', description)}\n${body}`;
}

describe('Snippet search', () => {
    let core: dashql.DashQL;
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let search: SnippetSearch | null = null;
    let registry: SnippetRegistry;

    beforeAll(async () => {
        core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
        const id = crypto.randomUUID();
        database = await HyperDB.create(new HyperDBEngine(client), {
            snippetsDatabasePath: await testDatabasePath(`dashql-snippet-search-${id}.hyper`),
            terminateEngine: false,
        });
        search = await SnippetSearch.connect(database);
        registry = buildSnippetRegistry(core, {
            'hyper/dates/month.sql': file('The first day of the month.', "select date_trunc('month', current_date);"),
            'trino/dates/month.sql': file('The first day of the month.', "select date_trunc('month', current_date);"),
            'hyper/json/access.sql': file('Read a field of a JSON object.', `select '{"a": 1}'::json->'a';`),
            'trino/strings/split.sql': file('Split a text.', "select split('a,b', ',');"),
            'hyper/strings/percent.sql': file('Format a share as 100%.', "select 0.5 * 100 || '%';"),
            'hyper/strings/like.sql': file('Match names with an underscore.', "select 'a_b' like 'a\\_b';"),
        });
        expect(registry.errors).toEqual([]);
    }, 60_000);

    afterAll(async () => {
        await search?.close();
        await database?.terminate();
        if (!sharedClient) await client?.terminate();
    });

    async function ids(connector: ConnectorType, text: string, snippets = registry): Promise<string[]> {
        return [...await search!.search(snippets, connector, text)].sort();
    }

    it('finds the snippets with the text in their id or text with the description, ignoring case', async () => {
        expect(await ids(ConnectorType.HYPER, 'json')).toEqual(['json/access']);
        expect(await ids(ConnectorType.HYPER, 'FIRST DAY')).toEqual(['dates/month']);
        expect(await ids(ConnectorType.HYPER, 'date_trunc')).toEqual(['dates/month']);
        expect(await ids(ConnectorType.HYPER, 'nothing like this')).toEqual([]);
    });

    it('finds only the snippets of the connector', async () => {
        expect(await ids(ConnectorType.TRINO, 'split')).toEqual(['strings/split']);
        expect(await ids(ConnectorType.HYPER, 'split')).toEqual([]);
        // The Hyper snippets run on Data Cloud as well
        expect(await ids(ConnectorType.SALESFORCE_DATA_CLOUD, 'json')).toEqual(['json/access']);
    });

    it('matches the wildcards of the text literally', async () => {
        expect(snippetSearchPattern('100%_a\\b')).toEqual('%100\\%\\_a\\\\b%');
        expect(await ids(ConnectorType.HYPER, '100%')).toEqual(['strings/percent']);
        expect(await ids(ConnectorType.HYPER, "a_b'")).toEqual(['strings/like']);
        expect(await ids(ConnectorType.HYPER, "'%'")).toEqual(['strings/percent']);
    });

    it('searches the snippets of another registry', async () => {
        const bundled = getBundledSnippets(core);
        // The empty text matches every snippet of the connector
        const expected = snippetsForConnector(bundled, ConnectorType.HYPER).map(snippet => snippet.id).sort();
        expect(expected.length).toBeGreaterThan(0);
        expect(await ids(ConnectorType.HYPER, '', bundled)).toEqual(expected);
        expect(await ids(ConnectorType.HYPER, 'json')).toEqual(['json/access']);
    });

    it('fills the snippet table without evaluating code, the Content-Security-Policy of the app forbids it', async () => {
        const evaluate = globalThis.Function;
        globalThis.Function = new Proxy(evaluate, {
            apply: () => { throw new EvalError('unsafe-eval'); },
            construct: () => { throw new EvalError('unsafe-eval'); },
        });
        try {
            const other = buildSnippetRegistry(core, { 'hyper/json/access.sql': file('Read a field of a JSON object.', "select '{}'::json;") });
            expect(await ids(ConnectorType.HYPER, 'json', other)).toEqual(['json/access']);
        } finally {
            globalThis.Function = evaluate;
        }
    });

    it('runs concurrent searches one after the other', async () => {
        const results = await Promise.all(['json', 'month', 'split'].map(text => ids(ConnectorType.HYPER, text)));
        expect(results).toEqual([['json/access'], ['dates/month'], []]);
    });
});
