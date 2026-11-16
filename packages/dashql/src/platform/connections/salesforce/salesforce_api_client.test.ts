import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SALESFORCE_DATA_SPACE, collectSalesforceAuthInfo, getSalesforceDataSpace } from './salesforce_api_client.js';

function makeDataCloudAccessToken(customAttributes: unknown): connection.SalesforceDataCloudAccessToken {
    return {
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(1).toISOString(),
        instanceUrl: 'https://data.example.com/',
        jwt: {
            raw: 'data-cloud-token',
            header: {},
            payload: {
                audienceTenantId: 'tenant-1',
                customAttributes,
            },
        },
    } as connection.SalesforceDataCloudAccessToken;
}

describe('Salesforce auth info', () => {
    it('collects the tenants, the instance and the raw tokens of a login', () => {
        const core = { accessToken: 'opaque-core-token' } as connection.SalesforceCoreAccessToken;
        expect(collectSalesforceAuthInfo(core, makeDataCloudAccessToken({ dataspace: 'Sales' }))).toEqual({
            coreAccessToken: 'opaque-core-token', coreTenantId: 'tenant-1', offcoreTenantId: 'tenant-1', offcoreAccessToken: null,
            offcoreInstanceUrl: 'https://data.example.com/', offcoreRawJwt: 'data-cloud-token', dataspace: 'Sales',
        });
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

    it('falls back to the default data space', () => {
        expect(getSalesforceDataSpace(makeDataCloudAccessToken({}))).toBe(DEFAULT_SALESFORCE_DATA_SPACE);
    });
});
