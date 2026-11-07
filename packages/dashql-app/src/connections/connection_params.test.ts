import { describe, it, expect } from 'vitest';
import { sanitizeConnectionParamsForSharing, createAttachedConnectionParamsForConnector, createConnectionParamsSignature, createDefaultConnectionParamsForConnector, ConnectionParams, DEFAULT_HYPER_ENDPOINT } from './connection_params.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';

describe('createDefaultConnectionParamsForConnector', () => {
    it('uses WASM for browser Hyper', () => {
        const params = createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER]);
        expect(params).toMatchObject({ hyper: { protocol: 'WASM' } });
    });

    it('uses WASM for Electron Hyper', () => {
        (globalThis as any).dashqlElectron = {};
        try {
            const params = createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER]);
            expect(params).toMatchObject({ hyper: { protocol: 'WASM' } });
        } finally {
            delete (globalThis as any).dashqlElectron;
        }
    });

    it('gives Database.com the params of Salesforce and the default database', () => {
        const salesforce = createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD]);
        const dbcom = createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.DBCOM]);
        expect(dbcom).toEqual({ dbcom: 'salesforce' in salesforce ? { ...salesforce.salesforce, databaseName: 'default' } : null });
    });
});

describe('createAttachedConnectionParamsForConnector', () => {
    it('attaches a Hyper server, the embedded Hyper has a single connection', () => {
        const params = createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER]);
        expect(params).toMatchObject({ hyper: { protocol: 'V3_HTTP', endpoint: DEFAULT_HYPER_ENDPOINT } });
    });

    it('keeps the defaults of the other connectors', () => {
        for (const connector of [ConnectorType.TRINO, ConnectorType.SALESFORCE_DATA_CLOUD]) {
            expect(createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[connector]))
                .toEqual(createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[connector]));
        }
    });
});

describe('sanitizeConnectionParamsForSharing', () => {
    it('omits all Hyper headers and query parameters without mutating local settings', () => {
        const params: ConnectionParams = { hyper: {
            protocol: 'V3_HTTP', endpoint: 'https://hyper.example.com',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            attachedDatabases: [{ path: 'database.hyper', alias: 'db' }],
            metadata: { authorization: 'bearer-secret', Cookie: 'session-secret', 'x-api-key': 'key-secret', arbitrary: 'unknown-secret' },
            queryParameters: { password: 'query-secret', harmless: 'value' },
            draftRows: { metadata: [{ key: '', value: 'draft-secret' }] },
        } };
        const sanitized = sanitizeConnectionParamsForSharing(params);
        expect(sanitized).toEqual({ hyper: {
            protocol: 'V3_HTTP', endpoint: 'https://hyper.example.com',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
            attachedDatabases: [{ path: 'database.hyper', alias: 'db' }],
        } });
        expect(params.hyper.metadata?.authorization).toBe('bearer-secret');
        expect(params.hyper.queryParameters?.password).toBe('query-secret');
    });

    it('omits all Trino headers while preserving nonsecret connection identity', () => {
        const params: ConnectionParams = { trino: {
            endpoint: 'https://trino.example.com', catalogName: 'catalog', schemaNames: ['public'],
            auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: 'password' } },
            metadata: { Authorization: 'bearer-secret', cookie: 'session-secret', api_key: 'key-secret', arbitrary: 'unknown-secret' },
        } };
        expect(sanitizeConnectionParamsForSharing(params)).toEqual({ trino: {
            endpoint: 'https://trino.example.com', catalogName: 'catalog', schemaNames: ['public'],
            auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: '' } },
        } });
        expect(params.trino.metadata?.Authorization).toBe('bearer-secret');
    });
    it('strips the salesforce consumer secret but keeps the identity and login hint', () => {
        const params: ConnectionParams = {
            salesforce: {
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params) as any;
        expect(sanitized.salesforce.appConsumerSecret).toBe('');
        expect(sanitized.salesforce.appConsumerKey).toBe('consumer-key');
        expect(sanitized.salesforce.instanceUrl).toBe('https://example.my.salesforce.com');
        expect(sanitized.salesforce.login).toBe('user@example.com');
        // The original must not be mutated.
        expect(params.salesforce!.appConsumerSecret).toBe('super-secret');
    });

    it('clears the salesforce login hint when withLoginHint is false but keeps the rest of the identity', () => {
        const params: ConnectionParams = {
            salesforce: {
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params, false) as any;
        expect(sanitized.salesforce.login).toBe('');
        expect(sanitized.salesforce.appConsumerSecret).toBe('');
        expect(sanitized.salesforce.appConsumerKey).toBe('consumer-key');
        expect(sanitized.salesforce.instanceUrl).toBe('https://example.my.salesforce.com');
        // The original must not be mutated.
        expect(params.salesforce!.login).toBe('user@example.com');
    });

    it('strips the trino basic-auth secret but keeps the username', () => {
        const params: ConnectionParams = {
            trino: {
                endpoint: 'https://trino.example.com',
                catalogName: 'tpch',
                auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: 'password' } },
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params) as any;
        expect(sanitized.trino.auth.basic.secret).toBe('');
        expect(sanitized.trino.auth.basic.username).toBe('alice');
        expect(sanitized.trino.endpoint).toBe('https://trino.example.com');
        expect(params.trino!.auth.basic!.secret).toBe('password');
    });

    it('clears the trino basic-auth username when withLoginHint is false', () => {
        const params: ConnectionParams = {
            trino: {
                endpoint: 'https://trino.example.com',
                catalogName: 'tpch',
                auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: 'password' } },
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params, false) as any;
        expect(sanitized.trino.auth.basic.username).toBe('');
        expect(sanitized.trino.auth.basic.secret).toBe('');
        expect(sanitized.trino.endpoint).toBe('https://trino.example.com');
        expect(params.trino!.auth.basic!.username).toBe('alice');
    });

    it('clears hyper TLS file paths but keeps the endpoint and protocol', () => {
        const params: ConnectionParams = {
            hyper: {
                protocol: 'V3_HTTP',
                endpoint: 'https://hyper.example.com',
                tls: { clientKeyPath: '/k', clientCertPath: '/c', caCertsPath: '/ca' },
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params) as any;
        expect(sanitized.hyper.tls.clientKeyPath).toBe('');
        expect(sanitized.hyper.tls.clientCertPath).toBe('');
        expect(sanitized.hyper.tls.caCertsPath).toBe('');
        expect(sanitized.hyper.endpoint).toBe('https://hyper.example.com');
    });

});

describe('createConnectionParamsSignature', () => {
    it('identifies Trino results by the default catalog and schema, not by the loaded catalogs', () => {
        const trino = (defaultSchema: string, catalogs: string[]) => ({ trino: { endpoint: 'https://trino', defaultCatalog: 'hive', defaultSchema, catalogs, auth: { authType: 'AUTH_BASIC', basic: { username: 'u' } } } }) as unknown as ConnectionParams;
        const params = trino('sales', ['hive.sales', 'iceberg']);
        expect(createConnectionParamsSignature(params)).toEqual(createConnectionParamsSignature(trino('sales', ['iceberg'])));
        expect(createConnectionParamsSignature(params)).not.toEqual(createConnectionParamsSignature(trino('hr', ['hive.sales', 'iceberg'])));
        expect(createConnectionParamsSignature(params)).toMatchObject({ case: 'trino', defaults: { catalog: 'hive', schema: 'sales' } });
    });

    it('identifies Trino results of params that predate the default catalog like the renamed params', () => {
        const legacy = { trino: { endpoint: 'https://trino', catalogName: 'hive', schemaNames: ['sales'], auth: { authType: 'AUTH_BASIC' } } } as unknown as ConnectionParams;
        const current = { trino: { endpoint: 'https://trino', defaultCatalog: 'hive', catalogs: ['hive.sales'], auth: { authType: 'AUTH_BASIC' } } } as unknown as ConnectionParams;
        expect(createConnectionParamsSignature(legacy)).toEqual(createConnectionParamsSignature(current));
    });

    it('leaves the Trino credentials and user out of the signature', () => {
        const trino = (username: string, secret: string) => ({ trino: { endpoint: 'https://trino', defaultCatalog: 'hive', auth: { authType: 'AUTH_BASIC', basic: { username, secret } } } }) as unknown as ConnectionParams;
        const signature = createConnectionParamsSignature(trino('alice', 'a'));
        expect(signature).toEqual(createConnectionParamsSignature(trino('bob', 'b')));
        expect(JSON.stringify(signature)).not.toContain('alice');
    });

    it('leaves the Salesforce login out of the signature', () => {
        const salesforce = (login: string) => ({ salesforce: { instanceUrl: 'https://org', appConsumerKey: 'key', appConsumerSecret: 'secret', login } }) as unknown as ConnectionParams;
        const signature = createConnectionParamsSignature(salesforce('alice@org'));
        expect(signature).toEqual(createConnectionParamsSignature(salesforce('bob@org')));
        expect(signature).toEqual({ case: 'salesforce', instanceUrl: 'https://org', appConsumerKey: 'key' });
    });

    it('leaves the gRPC metadata of Hyper out of the signature', () => {
        const hyper = (metadata: Record<string, string>) => ({ hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper', metadata } }) as unknown as ConnectionParams;
        const signature = createConnectionParamsSignature(hyper({ authorization: 'Bearer a' }));
        expect(signature).toEqual(createConnectionParamsSignature(hyper({ authorization: 'Bearer b' })));
        expect(signature).not.toHaveProperty('gRPCMetadata');
    });

    it('ignores the order of the attached databases and parameters of Hyper', () => {
        const hyper = (paths: string[], metadata: Record<string, string>) => ({
            hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper', attachedDatabases: paths.map(path => ({ path, alias: path })), metadata, queryParameters: { b: '2', a: '1' } },
        }) as unknown as ConnectionParams;
        const signature = createConnectionParamsSignature(hyper(['/b', '/a'], { y: '1', x: '2' }));
        expect(signature).toEqual(createConnectionParamsSignature(hyper(['/a', '/b'], { x: '2', y: '1' })));
        expect(signature).toMatchObject({ case: 'hyper', attachedDatabases: [{ path: '/a' }, { path: '/b' }], queryParameters: [['a', '1'], ['b', '2']] });
    });
});

