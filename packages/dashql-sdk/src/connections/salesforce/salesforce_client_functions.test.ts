import { describe, expect, it } from 'vitest';

import { SALESFORCE_CLIENT_FUNCTIONS } from './salesforce_client_functions.js';
import type { SalesforceConnectionStateDetails } from './salesforce_connection_state.js';

const CONNECTED = {
    channel: {
        coreToken: { accessToken: 'core-token', instanceUrl: 'https://org.my.salesforce.com' },
        dataCloudToken: { instanceUrl: 'https://tenant.c360a.salesforce.com/', jwt: { raw: 'tenant-jwt' } },
    },
} as unknown as SalesforceConnectionStateDetails;
const OFFLINE = { channel: null } as unknown as SalesforceConnectionStateDetails;

describe('The Data 360 client functions of a Salesforce connection', () => {
    it.each([
        ['core', 'https://org.my.salesforce.com/', 'Bearer core-token'],
        ['connect', 'https://org.my.salesforce.com/', 'Bearer core-token'],
        ['tenant', 'https://tenant.c360a.salesforce.com/', 'Bearer tenant-jwt'],
    ])('send the calls of the host %s with its token', async (host, url, authorization) => {
        const target = await SALESFORCE_CLIENT_FUNCTIONS.resolveHost(CONNECTED, host);
        expect(target.baseUrl.toString()).toEqual(url);
        expect(target.headers.Authorization).toEqual(authorization);
    });

    it('say so when the token of the tenant has expired', async () => {
        const token = (expiresAt: string) => ({ channel: { ...CONNECTED.channel, dataCloudToken: { ...CONNECTED.channel!.dataCloudToken, expiresAt } } }) as unknown as SalesforceConnectionStateDetails;
        await expect(SALESFORCE_CLIENT_FUNCTIONS.resolveHost(token('2000-01-01T00:00:00Z'), 'tenant')).rejects.toThrow(/has expired, connect again/);
        await expect(SALESFORCE_CLIENT_FUNCTIONS.resolveHost(token('2999-01-01T00:00:00Z'), 'tenant')).resolves.toBeDefined();
    });

    it('have no other host', async () => {
        await expect(SALESFORCE_CLIENT_FUNCTIONS.resolveHost(CONNECTED, 'other')).rejects.toThrow(/no host other/);
    });

    it('need a login for a host, and none for the variables', async () => {
        await expect(SALESFORCE_CLIENT_FUNCTIONS.resolveHost(OFFLINE, 'core')).rejects.toThrow(/not set up/);
        expect(SALESFORCE_CLIENT_FUNCTIONS.variables(OFFLINE)).toEqual({ api_version: '68.0' });
    });

    it('fill in every host of the spec', async () => {
        const spec = await SALESFORCE_CLIENT_FUNCTIONS.loadSpec();
        for (const host of Object.keys(spec.hosts ?? {})) {
            await expect(SALESFORCE_CLIENT_FUNCTIONS.resolveHost(CONNECTED, host)).resolves.toBeDefined();
        }
    });
});
