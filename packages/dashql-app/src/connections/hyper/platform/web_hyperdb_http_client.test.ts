import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { describe, it, expect } from 'vitest';

import { DEFAULT_PARALLEL_CHUNKS, WebHyperDatabaseClient } from './web_hyperdb_http_client.js';
import { HyperDatabaseConnectionContext } from '@ankoh/dashql/platform/connections/hyper/hyperdb_grpc_client';

const ENDPOINT = 'https://hyper.mock.local';

function makeHyperArgs(): connection.HyperConnectionParams {
    return {
        protocol: 'V3_HTTP',
        endpoint: ENDPOINT,
        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
    } as connection.HyperConnectionParams;
}

// The query executor of the runtime sends the requests of a channel over HTTP, the channel describes itself
describe('WebHyperDatabaseClient', () => {
    it('rejects a missing endpoint', async () => {
        const args = { ...makeHyperArgs(), endpoint: '' } as connection.HyperConnectionParams;
        const context = { getAttachedDatabases: () => [], getRequestMetadata: async () => ({}), getQueryParameters: () => ({}) };
        await expect(new WebHyperDatabaseClient().connect(args, context)).rejects.toThrow(/endpoint/);
    });

    it('describes the channel with the auth headers of the context at the time of the call', async () => {
        let token = 'one';
        const clientContext = { dashql: { connectionId: 'c1', queryType: 'user' } };
        const context: HyperDatabaseConnectionContext = {
            getAttachedDatabases: () => [{ path: 'hyper.cloud:default', alias: 'lakehouse' }],
            getRequestMetadata: async () => ({ authorization: `Bearer ${token}` }),
            getQueryParameters: () => ({ time_zone: 'UTC' }),
            getClientContext: () => clientContext,
        };
        const channel = await new WebHyperDatabaseClient({ parallelChunks: 2 }).connect(makeHyperArgs(), context);
        expect(await channel.describeHttp!()).toEqual({
            params: { endpoint: ENDPOINT, attachedDatabases: [{ path: 'hyper.cloud:default', alias: 'lakehouse' }], queryParameters: { time_zone: 'UTC' } },
            clientContext,
            auth: { authorization: 'Bearer one' },
            parallelChunks: 2,
        });
        token = 'two';
        expect((await channel.describeHttp!())!.auth).toEqual({ authorization: 'Bearer two' });
        await expect(channel.executeQuery({ query: 'select 1' } as never)).rejects.toThrow(/runtime/);
    });

    it('fetches the default number of chunks at once', async () => {
        const context = { getAttachedDatabases: () => [], getRequestMetadata: async () => ({}), getQueryParameters: () => ({}) };
        const channel = await new WebHyperDatabaseClient().connect(makeHyperArgs(), context);
        expect((await channel.describeHttp!())!.parallelChunks).toBe(DEFAULT_PARALLEL_CHUNKS);
    });
});
