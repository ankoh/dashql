import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpFetchResult } from '../../../../platform/http/http_client.js';
import { Logger } from '../../../../platform/logger/logger.js';
import {
    DEFAULT_SALESFORCE_DATA_SPACE,
    formatSalesforceMetadataProgress,
    getSalesforceDataSpace,
    getSalesforceLakehousePath,
    SalesforceApiClient,
} from './salesforce_api_client.js';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

function makeResponse(body: unknown, status = 200): HttpFetchResult {
    const text = JSON.stringify(body);
    return {
        headers: new Headers(),
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
        json: async () => body,
        text: async () => text,
    };
}

function makeDataCloudAccessToken(customAttributes: unknown): connection.SalesforceDataCloudAccessToken {
    return {
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(1).toISOString(),
        jwt: {
            raw: 'data-cloud-token',
            header: {},
            payload: {
                customAttributes,
            },
        },
    } as connection.SalesforceDataCloudAccessToken;
}

function encodeJwtPart(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('SalesforceApiClient metadata', () => {
    const logger = new NullLogger();

    it('requests metadata separately for each entity type', async () => {
        const responses = new Map<string, unknown>([
            ['/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=DataModelObject', {
                metadata: [{
                    name: 'Individual__dlm',
                    displayName: 'Individual DMO',
                    category: 'Profile',
                    fields: [{ name: 'FirstName__c', displayName: 'First Name', type: 'Text', businessType: 'Text' }],
                    primaryKeys: [{ indexOrder: '0', name: 'Id__c', displayName: 'ID' }],
                }],
            }],
            ['/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=DataLakeObject', {
                metadata: [{
                    name: 'Account__dll',
                    displayName: 'Account DLO',
                    category: 'Profile',
                    fields: [{ name: 'AccountId__c', displayName: 'Account ID', type: 'Text', businessType: 'Text' }],
                    primaryKeys: [],
                }],
            }],
            ['/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=CalculatedInsight', {
                metadata: [{
                    name: 'Revenue__cio',
                    displayName: 'Revenue Insight',
                    category: 'CalculatedInsight',
                    fields: [{ name: 'Amount__c', displayName: 'Amount', type: 'Number', businessType: 'Measure' }],
                    primaryKeys: [],
                }],
            }],
        ]);
        const fetch = vi.fn().mockImplementation(async (url: URL) => {
            return makeResponse(responses.get(`${url.pathname}${url.search}`) ?? {});
        });
        const httpClient: HttpClient = { fetch };
        const client = new SalesforceApiClient(logger, httpClient);
        const coreToken = {
            createdAt: new Date(0).toISOString(),
            accessToken: 'core-token',
            instanceUrl: 'https://example.my.salesforce.com/',
        } as connection.SalesforceCoreAccessToken;
        const onProgress = vi.fn();

        const metadata = await client.getDataCloudMetadata(
            coreToken,
            'Marketing Space',
            new AbortController().signal,
            onProgress,
        );

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls.map(([url]) => url.toString()).sort()).toEqual([
            'https://example.my.salesforce.com/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=CalculatedInsight',
            'https://example.my.salesforce.com/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=DataLakeObject',
            'https://example.my.salesforce.com/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space&entityType=DataModelObject',
        ]);
        for (const [, init] of fetch.mock.calls) {
            expect((init.headers as Headers).get('authorization')).toBe('Bearer core-token');
        }
        expect(metadata.metadata?.map(entity => entity.name)).toEqual([
            'Individual__dlm',
            'Account__dll',
            'Revenue__cio',
        ]);
        expect(metadata.metadata?.[0].fields?.[0].name).toBe('FirstName__c');
        expect(metadata.metadata?.[0].primaryKeys?.[0].name).toBe('Id__c');
        expect(metadata.metadata?.[2].fields?.map(field => field.name)).toEqual(['Amount__c']);
        expect(onProgress).toHaveBeenCalledWith({
            collection: 'DataModelObject',
            page: 1,
            loaded: 1,
            total: 1,
            state: 'complete',
        });
        expect(onProgress).toHaveBeenCalledWith({
            collection: 'DataLakeObject',
            page: 1,
            loaded: 1,
            total: 1,
            state: 'complete',
        });
    });

    it('returns successful metadata and logs details when one request fails', async () => {
        const fetch = vi.fn().mockImplementation(async (url: URL) => {
            if (url.searchParams.get('entityType') === 'DataLakeObject') {
                return makeResponse({ error: 'unavailable' }, 503);
            }
            return makeResponse({ metadata: [{ name: url.searchParams.get('entityType'), fields: [] }] });
        });
        const requestLogger = new NullLogger();
        const warn = vi.spyOn(requestLogger, 'warn');
        const client = new SalesforceApiClient(requestLogger, { fetch });
        const coreToken = {
            createdAt: new Date(0).toISOString(),
            accessToken: 'core-token',
            instanceUrl: 'https://example.my.salesforce.com',
        } as connection.SalesforceCoreAccessToken;
        const onProgress = vi.fn();

        await expect(client.getDataCloudMetadata(
            coreToken,
            'default',
            new AbortController().signal,
            onProgress,
        )).resolves.toEqual({
            metadata: [
                expect.objectContaining({ name: 'DataModelObject' }),
                expect.objectContaining({ name: 'CalculatedInsight' }),
            ],
        });
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(onProgress.mock.calls.filter(([progress]) => progress.state === 'complete')).toHaveLength(2);
        expect(onProgress.mock.calls.filter(([progress]) => progress.state === 'failed')).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith('Salesforce metadata request failed', {
            dataSpace: 'default',
            entityType: 'DataLakeObject',
            error: '503 Error — {"error":"unavailable"}',
        }, 'salesforce_api');
    });

    it('rejects with only the summary when every metadata request fails', async () => {
        const requestLogger = new NullLogger();
        const warn = vi.spyOn(requestLogger, 'warn');
        const fetch = vi.fn().mockResolvedValue(makeResponse({ error: 'unavailable' }, 503));
        const client = new SalesforceApiClient(requestLogger, { fetch });
        const coreToken = {
            createdAt: new Date(0).toISOString(),
            accessToken: 'core-token',
            instanceUrl: 'https://example.my.salesforce.com',
        } as connection.SalesforceCoreAccessToken;

        await expect(client.getDataCloudMetadata(
            coreToken,
            'default',
            new AbortController().signal,
        )).rejects.toThrow('Metadata: 0 done, 0 active, 3 failed | DMO failed | DLO failed | CI failed');
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('starts all metadata requests before waiting for responses', async () => {
        const pending: Array<(response: HttpFetchResult) => void> = [];
        const fetch = vi.fn().mockImplementation(() => new Promise<HttpFetchResult>(resolve => {
            pending.push(resolve);
        }));
        const client = new SalesforceApiClient(logger, { fetch });
        const coreToken = {
            createdAt: new Date(0).toISOString(),
            accessToken: 'core-token',
            instanceUrl: 'https://example.my.salesforce.com',
        } as connection.SalesforceCoreAccessToken;

        const metadata = client.getDataCloudMetadata(coreToken, 'default', new AbortController().signal);

        expect(fetch).toHaveBeenCalledTimes(3);
        pending.forEach(resolve => resolve(makeResponse({ metadata: [] })));
        await expect(metadata).resolves.toEqual({ metadata: [] });
    });

    it('formats aggregate progress for all three metadata requests', () => {
        const progress = new Map([
            ['DataModelObject', {
                collection: 'DataModelObject',
                page: 1,
                loaded: 120,
                total: 120,
                state: 'complete' as const,
            }],
            ['DataLakeObject', {
                collection: 'DataLakeObject',
                page: 1,
                loaded: 0,
                total: null,
                state: 'requesting' as const,
            }],
            ['CalculatedInsight', {
                collection: 'CalculatedInsight',
                page: 1,
                loaded: 0,
                total: null,
                state: 'failed' as const,
                error: '503 Error',
            }],
        ]);

        expect(formatSalesforceMetadataProgress(progress)).toBe(
            'Metadata: 1 done, 1 active, 1 failed | DMO 120 | DLO ... | CI failed',
        );
    });
});

describe('SalesforceApiClient Data Cloud token parsing', () => {
    it('decodes Base64URL JWT parts without changing the raw token', async () => {
        const payload = {
            exp: '1800000000',
            audienceTenantId: 'tenant-1',
            custom_attributes: { dataspace: 'Marketing' },
        };
        const rawToken = `${encodeJwtPart({ alg: 'none', marker: '\u083e' })}.${encodeJwtPart(payload)}.`;
        expect(rawToken).toMatch(/[-_]/);
        const fetch = vi.fn().mockResolvedValue(makeResponse({
            access_token: rawToken,
            instance_url: 'data.example.com',
            token_type: 'Bearer',
        }));
        const client = new SalesforceApiClient(new NullLogger(), { fetch });
        const coreToken = {
            accessToken: 'core-token',
            instanceUrl: 'https://example.my.salesforce.com',
        } as connection.SalesforceCoreAccessToken;

        const token = await client.getDataCloudAccessToken(coreToken, new AbortController().signal);

        expect(token.jwt?.raw).toBe(rawToken);
        expect(token.jwt?.payload?.audienceTenantId).toBe(payload.audienceTenantId);
        expect(getSalesforceDataSpace(token)).toBe('Marketing');
        expect(token.instanceUrl).toBe('https://data.example.com/');
    });
});

describe('Salesforce data-space resolution', () => {
    it('reads the selected data space from nested token attributes', () => {
        expect(getSalesforceDataSpace(makeDataCloudAccessToken({
            data: { dataspace: 'Marketing' },
        }))).toBe('Marketing');
    });

    it('supports the legacy flat token attribute', () => {
        expect(getSalesforceDataSpace(makeDataCloudAccessToken({
            dataspace: 'Sales',
        }))).toBe('Sales');
    });

    it('falls back to default and uses the same value in the lakehouse path', () => {
        const dataSpace = getSalesforceDataSpace(makeDataCloudAccessToken({}));
        expect(dataSpace).toBe(DEFAULT_SALESFORCE_DATA_SPACE);
        expect(getSalesforceLakehousePath('tenant-id', dataSpace)).toBe('lakehouse:tenant-id;default');
    });
});
