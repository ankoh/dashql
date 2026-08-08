import * as fs from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '../../core/index.js';
import { updateDemoSchemaCatalog } from './dataless_demo_catalog.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const FUNCTIONS_PATH = 'static/catalog/hyper/dashql-functions.sql';

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => {
    vi.unstubAllGlobals();
    dql.resetUnsafe();
});

describe('updateDemoSchemaCatalog', () => {
    it('loads the shared prefetched function catalog', async () => {
        const functionsSQL = await fs.readFile(FUNCTIONS_PATH, 'utf8');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('CREATE TABLE demo_table (id INTEGER);'))
            .mockResolvedValueOnce(new Response(functionsSQL));
        vi.stubGlobal('fetch', fetchMock);
        const catalog = dql.createCatalog();
        const relationScript = dql.createScript(catalog);
        const functionScript = dql.createScript(catalog);

        await updateDemoSchemaCatalog(
            'notebook',
            vi.fn(),
            1,
            catalog,
            dql,
            relationScript,
            functionScript,
        );

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(relationScript.toString()).toContain('CREATE TABLE demo_table');
        expect(functionScript.toString()).toBe(functionsSQL);
        expect(functionScript.getParsed().read().statementsLength()).toBe(350);
    });
});
