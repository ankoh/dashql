import * as fs from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '../../../../core/index.js';
import { updateSalesforceCatalog } from './salesforce_catalog_update.js';
import type { SalesforceConnectionStateDetails } from './salesforce_connection_state.js';

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

describe('updateSalesforceCatalog', () => {
    it('loads metadata relations and the prefetched function catalog', async () => {
        const functionsSQL = await fs.readFile(FUNCTIONS_PATH, 'utf8');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(functionsSQL)));
        const api = {
            getDataCloudMetadata: vi.fn().mockResolvedValue({
                metadata: [{
                    name: 'Account__dlm',
                    fields: [{ name: 'Id__c', type: 'Text' }],
                }],
            }),
        };
        const connection = {
            proto: {
                oauthState: {
                    coreAccessToken: {
                        accessToken: 'core-token',
                        instanceUrl: 'https://example.my.salesforce.com',
                    },
                    dataCloudAccessToken: {
                        jwt: { raw: 'data-cloud-token', payload: {} },
                    },
                },
            },
            channel: null,
        } as SalesforceConnectionStateDetails;
        const catalog = dql.createCatalog();
        const relationScript = dql.createScript(catalog);
        const functionScript = dql.createScript(catalog);
        const logger = { info: vi.fn() };

        await updateSalesforceCatalog(
            logger as any,
            connection,
            catalog,
            dql,
            relationScript,
            functionScript,
            api as any,
            new AbortController(),
        );

        expect(relationScript.toString()).toContain('CREATE TABLE "Account__dlm"');
        expect(functionScript.toString()).toBe(functionsSQL);
        expect(functionScript.getParsed().read().statementsLength()).toBe(350);
        expect(logger.info).toHaveBeenCalledWith(
            'Loaded Salesforce catalog script',
            expect.objectContaining({ tables: '1', functions: '350' }),
            'salesforce_catalog',
        );
    });
});
