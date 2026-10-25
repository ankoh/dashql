import * as dashql from '@ankoh/dashql-core';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestHyperDBClient, testDatabasePath } from '../../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, type HyperDBClient, type HyperDBConnection } from '../../../platform/hyperdb/hyperdb_wasm.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { SNIPPET_DATASETS_FOLDER } from './snippet.js';
import { getBundledSnippets, snippetText } from './snippet_registry.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('Snippet execution', () => {
    let core: dashql.DashQL;
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let connection: HyperDBConnection | null = null;

    beforeAll(async () => {
        core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
        const id = crypto.randomUUID();
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath(`dashql-snippets-compute-${id}.hyper`),
            defaultDatabasePath: await testDatabasePath(`dashql-snippets-${id}.hyper`),
            terminateEngine: false,
        });
        connection = await database.connect();
    }, 60_000);

    afterAll(async () => {
        await connection?.close();
        await database?.terminate();
        if (!sharedClient) await client?.terminate();
    });

    // The datasets load data over the network, the other snippets bring their own data
    it('runs every Hyper snippet with its own data in Hyper', async () => {
        const registry = getBundledSnippets(core);
        const recipes = registry.snippets.filter(snippet => snippet.category !== SNIPPET_DATASETS_FOLDER
            && snippet.connectors.includes(ConnectorType.HYPER));
        expect(recipes.length).toBeGreaterThan(0);
        for (const recipe of recipes) {
            const text = snippetText(recipe, ConnectorType.HYPER);
            const result = await connection!.query(text).catch((error: unknown) => {
                throw new Error(`snippet ${recipe.id} failed: ${String(error)}`);
            });
            expect(result.numRows, recipe.id).toBeGreaterThan(0);
        }
    });
});
