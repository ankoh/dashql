import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

// The params of connections that leave the app: the core strips the secrets (`workbook_format::sharing` of the
// runtime crate) and tells params apart that describe different connections.

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});

const TLS = { clientKeyPath: '', clientCertPath: '', caCertsPath: '' };

describe('sanitizeConnectionParams', () => {
    it('drops the headers, the query parameters, the draft rows and the TLS files of Hyper', () => {
        const params = { hyper: {
            protocol: 'V3_HTTP', endpoint: 'https://hyper.example.com',
            tls: { clientKeyPath: '/k', clientCertPath: '/c', caCertsPath: '/ca' },
            attachedDatabases: [{ path: 'database.hyper', alias: 'db' }],
            metadata: { authorization: 'bearer-secret', arbitrary: 'unknown-secret' },
            queryParameters: { password: 'query-secret' },
            draftRows: { metadata: [{ key: '', value: 'draft-secret' }] },
        } };
        expect(dql!.sanitizeConnectionParams(params)).toEqual({ hyper: {
            protocol: 'V3_HTTP', endpoint: 'https://hyper.example.com', tls: TLS,
            attachedDatabases: [{ path: 'database.hyper', alias: 'db' }],
        } });
        // The params of the caller stay as they are
        expect(params.hyper.metadata.authorization).toBe('bearer-secret');
    });

    it('drops the basic-auth secret and the headers of Trino, the user only without the login hint', () => {
        const params = { trino: {
            endpoint: 'https://trino.example.com', catalogName: 'tpch',
            auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: 'password' } },
            metadata: { Authorization: 'bearer-secret' },
        } };
        expect(dql!.sanitizeConnectionParams(params)).toEqual({ trino: {
            endpoint: 'https://trino.example.com', catalogName: 'tpch',
            auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: '' } },
        } });
        expect(dql!.sanitizeConnectionParams(params, false).trino.auth.basic.username).toBe('');
    });

    it('drops the secret of the connected app of Salesforce, the login only without the login hint', () => {
        const params = { salesforce: {
            instanceUrl: 'https://example.my.salesforce.com', appConsumerKey: 'key', appConsumerSecret: 'secret', login: 'me@example.com',
        } };
        expect(dql!.sanitizeConnectionParams(params)).toEqual({ salesforce: { ...params.salesforce, appConsumerSecret: '' } });
        expect(dql!.sanitizeConnectionParams(params, false)).toEqual({ salesforce: { ...params.salesforce, appConsumerSecret: '', login: '' } });
    });
});

describe('connectionParamsShareEqual', () => {
    const grpc = (endpoint: string, token?: string) => ({ hyper: { protocol: 'V3_GRPC', endpoint, ...(token ? { metadata: { auth: token } } : {}) } });

    it('ignores the secrets and the login hints', () => {
        expect(dql!.connectionParamsShareEqual(grpc('http://hyper', 'one'), grpc('http://hyper', 'two'))).toBe(true);
        expect(dql!.connectionParamsShareEqual(grpc('http://hyper'), grpc('http://elsewhere'))).toBe(false);
        const salesforce = (login: string) => ({ salesforce: { instanceUrl: 'https://org', appConsumerKey: 'key', appConsumerSecret: 's', login } });
        expect(dql!.connectionParamsShareEqual(salesforce('me'), salesforce('you'))).toBe(true);
    });

    it('takes empty lists and maps as absent and tells the connectors apart', () => {
        const defaults = { hyper: { protocol: 'WASM', endpoint: '', tls: TLS } };
        const exported = { hyper: { protocol: 'WASM', endpoint: '', tls: TLS, attachedDatabases: [], metadata: {}, queryParameters: {} } };
        expect(dql!.connectionParamsShareEqual(defaults, exported)).toBe(true);
        expect(dql!.connectionParamsShareEqual({ trino: { endpoint: 'http://hyper' } }, grpc('http://hyper'))).toBe(false);
    });
});
