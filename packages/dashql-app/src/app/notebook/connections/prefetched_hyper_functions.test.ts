import * as fs from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import * as dashql from '../../../core/index.js';
import { fetchPrefetchedHyperFunctions, loadPrefetchedHyperFunctions, qualifyPrefetchedHyperFunctions } from './prefetched_hyper_functions.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const ASSET_PATH = 'static/catalog/hyper/dashql-functions.sql';

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => {
    dql.resetUnsafe();
});

describe('prefetched Hyper functions', () => {
    it('parses the bundled function catalog', async () => {
        const sql = await fs.readFile(ASSET_PATH, 'utf8');
        const catalog = dql.createCatalog();
        const script = dql.createScript(catalog);

        const functionCount = loadPrefetchedHyperFunctions(dql, catalog, script, sql);

        expect(functionCount).toBe(350);
        expect(sql).toContain('CREATE FUNCTION "default"."pg_catalog"."date_add"() RETURNS any;');
        expect(sql).toContain('CREATE AGGREGATE "default"."pg_catalog"."count"() RETURNS any;');
    });

    it('uses the bundled SQL without fetching a runtime URL', async () => {
        await expect(fetchPrefetchedHyperFunctions()).resolves.toContain(
            'CREATE FUNCTION "default"."pg_catalog"."abs"() RETURNS any;',
        );
    });

    it('qualifies functions for the user-facing Hyper database', () => {
        const sql = qualifyPrefetchedHyperFunctions('hyper');

        expect(sql).toContain('CREATE FUNCTION "hyper"."pg_catalog"."abs"() RETURNS any;');
        expect(sql).not.toContain('"default"."pg_catalog"');
    });

    it('rejects invalid SQL before replacing the function script', () => {
        const catalog = dql.createCatalog();
        const script = dql.createScript(catalog);
        script.replaceText('-- existing functions');

        expect(() => loadPrefetchedHyperFunctions(dql, catalog, script, '<!doctype html><html></html>'))
            .toThrow('contains invalid SQL');
        expect(script.toString()).toBe('-- existing functions');
    });
});
