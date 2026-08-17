import * as fs from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '../../../core/index.js';
import { fetchPrefetchedHyperFunctions, loadPrefetchedHyperFunctions } from './prefetched_hyper_functions.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const ASSET_PATH = 'static/catalog/hyper/dashql-functions.sql';

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => {
    vi.unstubAllGlobals();
    dql.resetUnsafe();
});

describe('prefetched Hyper functions', () => {
    it('parses the bundled function catalog', async () => {
        const sql = await fs.readFile(ASSET_PATH, 'utf8');
        const catalog = dql.createCatalog();
        const script = dql.createScript(catalog);

        const functionCount = loadPrefetchedHyperFunctions(catalog, script, sql);

        expect(functionCount).toBe(350);
        expect(sql).toContain('CREATE FUNCTION "default"."pg_catalog"."date_add"() RETURNS any;');
        expect(sql).toContain('CREATE AGGREGATE "default"."pg_catalog"."count"() RETURNS any;');
    });

    it('rejects an unavailable asset', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {
            status: 404,
            statusText: 'Not Found',
        })));

        await expect(fetchPrefetchedHyperFunctions()).rejects.toThrow(
            'failed to load prefetched Hyper functions: 404 Not Found',
        );
    });
});
