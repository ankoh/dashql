import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '../../../../core/index.js';
import { PREFETCHED_HYPER_FUNCTIONS_SQL } from '../prefetched_hyper_functions.js';
import { updateSalesforceCatalog } from './salesforce_catalog_update.js';
import type { SalesforceConnectionStateDetails } from './salesforce_connection_state.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => {
    vi.unstubAllGlobals();
    dql.resetUnsafe();
});

describe('updateSalesforceCatalog', () => {
    it.each(['V3_GRPC', 'V3_HTTP'] as const)('loads %s metadata relations and the prefetched function catalog', async protocol => {
        const functionsSQL = PREFETCHED_HYPER_FUNCTIONS_SQL;
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
                setupParams: { hyperProtocol: protocol },
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

        expect(relationScript.toString()).toContain('CREATE TABLE "lakehouse"."public"."Account__dlm"');
        const catalogSnapshot = catalog.createSnapshot().read();
        const findEntry = (
            begin: number,
            count: number,
            readEntry: (index: number, entry: dashql.buffers.catalog.FlatCatalogEntry) => dashql.buffers.catalog.FlatCatalogEntry | null,
            name: string,
        ) => {
            for (let index = begin; index < begin + count; ++index) {
                const entry = readEntry(index, new dashql.buffers.catalog.FlatCatalogEntry());
                if (entry != null && catalogSnapshot.readName(entry.nameId()) === name) return entry;
            }
            return null;
        };
        const database = findEntry(
            0,
            catalogSnapshot.catalogReader.databasesLength(),
            (index, entry) => catalogSnapshot.catalogReader.databases(index, entry),
            'lakehouse',
        );
        expect(database).not.toBeNull();
        const schema = findEntry(
            database!.childBegin(),
            database!.childCount(),
            (index, entry) => catalogSnapshot.catalogReader.schemas(index, entry),
            'public',
        );
        expect(schema).not.toBeNull();
        expect(findEntry(
            schema!.childBegin(),
            schema!.childCount(),
            (index, entry) => catalogSnapshot.catalogReader.tables(index, entry),
            'Account__dlm',
        )).not.toBeNull();
        expect(relationScript.toString()).not.toContain('"sf"."public"');
        const text = 'select * from Acc';
        const query = dql.createScript(catalog);
        query.insertTextAt(0, text);
        query.analyze();
        query.moveCursor(text.length);
        const candidates = query.completeAtCursor(10).read();
        const account = Array.from({ length: candidates.candidatesLength() }, (_, index) => candidates.candidates(index))
            .find(candidate => candidate?.completionText() === '"Account__dlm"');
        expect(account).toBeDefined();
        const qualified = account!.catalogObjects(0)!;
        expect(Array.from({ length: qualified.qualifiedNameLength() }, (_, index) => qualified.qualifiedName(index)))
            .toEqual(['lakehouse', 'public', '"Account__dlm"']);
        expect(functionScript.toString()).toBe(functionsSQL);
        expect(functionScript.getParsed().read().statementsLength()).toBe(350);
        expect(logger.info).toHaveBeenCalledWith(
            'Loaded Salesforce catalog script',
            expect.objectContaining({ tables: '1', functions: '350' }),
            'salesforce_catalog',
        );
    });
});
