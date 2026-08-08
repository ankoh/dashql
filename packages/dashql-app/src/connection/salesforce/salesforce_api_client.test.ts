import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpFetchResult } from '../../platform/http/http_client.js';
import { Logger } from '../../platform/logger/logger.js';
import {
    DEFAULT_SALESFORCE_DATA_SPACE,
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

describe('SalesforceApiClient metadata', () => {
    const logger = new NullLogger();

    it('uses the Core Connect metadata API with explicit data-space scope', async () => {
        const fetch = vi.fn().mockResolvedValue(makeResponse({
            metadata: [
                {
                    name: 'Account__dll',
                    displayName: 'Account DLO',
                    category: 'Profile',
                    fields: [{ name: 'Id__c', displayName: 'ID', type: 'Text', businessType: 'Text' }],
                    primaryKeys: [],
                },
                {
                    name: 'Individual__dlm',
                    displayName: 'Individual DMO',
                    category: 'Profile',
                    fields: [{ name: 'FirstName__c', displayName: 'First Name', type: 'Text', businessType: 'Text' }],
                    primaryKeys: [],
                },
                {
                    name: 'Revenue__cio',
                    displayName: 'Revenue Insight',
                    category: 'CalculatedInsight',
                    fields: [{ name: 'Amount__c', displayName: 'Amount', type: 'Number', businessType: 'Number' }],
                    primaryKeys: [],
                },
            ],
        }));
        const httpClient: HttpClient = { fetch };
        const client = new SalesforceApiClient(logger, httpClient);
        const coreToken = {
            createdAt: new Date(0).toISOString(),
            accessToken: 'core-token',
            instanceUrl: 'https://example.my.salesforce.com/',
        } as connection.SalesforceCoreAccessToken;

        const metadata = await client.getDataCloudMetadata(coreToken, 'Marketing Space', new AbortController().signal);

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0];
        expect(url.toString()).toBe('https://example.my.salesforce.com/services/data/v64.0/ssot/metadata?dataspace=Marketing+Space');
        expect((init.headers as Headers).get('authorization')).toBe('Bearer core-token');
        expect(metadata.metadata?.map(entity => entity.name)).toEqual([
            'Account__dll',
            'Individual__dlm',
            'Revenue__cio',
        ]);
        expect(metadata.metadata?.[0].fields?.[0].name).toBe('Id__c');
    });

    it('rejects non-success responses', async () => {
        const fetch = vi.fn().mockResolvedValue(makeResponse({ error: 'unavailable' }, 503));
        const client = new SalesforceApiClient(logger, { fetch });
        const coreToken = {
            createdAt: new Date(0).toISOString(),
            accessToken: 'core-token',
            instanceUrl: 'https://example.my.salesforce.com',
        } as connection.SalesforceCoreAccessToken;

        await expect(client.getDataCloudMetadata(
            coreToken,
            'default',
            new AbortController().signal,
        )).rejects.toThrow('Salesforce metadata request failed: 503 Error');
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
