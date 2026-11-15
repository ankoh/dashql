import * as dashql from '@ankoh/dashql-core';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { TASK_UPDATE_SCHEDULER } from '@ankoh/dashql-runtime/store/store';
import { TestLogger } from '@ankoh/dashql-runtime/testing/test_logger';
import { getTestHyperDBClient, testDatabasePath } from '../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, type HyperDBClient, type HyperDBConnection } from '../../platform/hyperdb/hyperdb_wasm.js';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { SNIPPET_DATASETS_FOLDER } from './snippet.js';
import { getBundledSnippets, snippetText } from './snippet_registry.js';
import { quoteIdentifier } from '@ankoh/dashql-runtime/utils/sql_quote';

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
        // The last detach writes every table of the database, the results of all snippets and their analyses. They can go
        // first. Only for speed, a table that stays behind is written.
        const tables = await connection?.query(`
            SELECT c.relname AS name
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname = 'public'
        `).catch(() => null);
        for (const { name } of tables ?? []) {
            await connection!.execute(`DROP TABLE ${quoteIdentifier(String(name))}`).catch(() => {});
        }
        await connection?.close();
        await database?.terminate();
        if (!sharedClient) await client?.terminate();
    });

    // The datasets load data over the network, the other snippets bring their own data.
    // Like the query executor, every result is then analyzed in the compute database.
    it('runs every Hyper snippet with its own data in Hyper', async () => {
        const registry = getBundledSnippets(core);
        const recipes = registry.snippets.filter(snippet => snippet.category !== SNIPPET_DATASETS_FOLDER
            && snippet.connectors.includes(ConnectorType.HYPER));
        expect(recipes.length).toBeGreaterThan(0);
        const logger = new TestLogger();
        // The tasks of the analysis run in the core
        const runtime = new CoreRuntime({ logger, scheduler: TASK_UPDATE_SCHEDULER, setupCore: core, computeDatabase: database! });
        for (const [index, recipe] of recipes.entries()) {
            const text = snippetText(recipe, ConnectorType.HYPER);
            const result = await connection!.query(text).catch((error: unknown) => {
                throw new Error(`snippet ${recipe.id} failed: ${String(error)}`);
            });
            expect(result.numRows, recipe.id).toBeGreaterThan(0);
            await runtime.analyzeTable(index, result).catch((error: unknown) => {
                throw new Error(`snippet ${recipe.id} failed in compute: ${String(error)}`);
            });
        }
        runtime.destroy();
    }, 60_000);
});
