import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { describe, expect, it } from 'vitest';

import { collectSalesforceAuthInfo } from './salesforce_api_client.js';

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
            offcoreInstanceUrl: 'https://data.example.com/', offcoreRawJwt: 'data-cloud-token',
        });
    });
});
