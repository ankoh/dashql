import { beforeAll, describe, it, expect } from 'vitest';
import * as core from '../../core/index.js';
import {
    connectionParamsHaveLoginHint,
    connectionParamsWithoutDraftRows,
    createAttachedConnectionParamsForConnector,
    createDefaultConnectionParamsForConnector,
    DEFAULT_HYPER_ENDPOINT,
    type ConnectionParams,
} from './connection_params.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';

// The defaults, the draft rows and the login hints of the params come from the core module
declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('createDefaultConnectionParamsForConnector', () => {
    it('uses WASM for browser Hyper', () => {
        const params = createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.HYPER]);
        expect(params).toEqual({ hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } });
    });

    it('uses WASM for Electron Hyper', () => {
        (globalThis as any).dashqlElectron = {};
        try {
            const params = createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.HYPER]);
            expect(params).toMatchObject({ hyper: { protocol: 'WASM' } });
        } finally {
            delete (globalThis as any).dashqlElectron;
        }
    });

    it('gives Trino basic auth without catalogs', () => {
        const params = createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.TRINO]);
        expect(params).toEqual({ trino: { endpoint: '', catalogs: [], auth: { authType: 'AUTH_BASIC' } } });
    });

    it('gives Database.com the params of Salesforce and the default database', () => {
        const salesforce = createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD]);
        const dbcom = createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.DBCOM]);
        expect(salesforce).toEqual({ salesforce: { instanceUrl: '', appConsumerKey: '', appConsumerSecret: '', login: '' } });
        expect(dbcom).toEqual({ dbcom: 'salesforce' in salesforce ? { ...salesforce.salesforce, databaseName: dql.hyperCloudDefaultDatabaseName() } : null });
    });
});

describe('createAttachedConnectionParamsForConnector', () => {
    it('attaches a Hyper server, the embedded Hyper has a single connection', () => {
        const params = createAttachedConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.HYPER]);
        expect(params).toMatchObject({ hyper: { protocol: 'V3_HTTP', endpoint: DEFAULT_HYPER_ENDPOINT } });
    });

    it('keeps the defaults of the other connectors', () => {
        for (const connector of [ConnectorType.TRINO, ConnectorType.SALESFORCE_DATA_CLOUD]) {
            expect(createAttachedConnectionParamsForConnector(dql, CONNECTOR_INFOS[connector]))
                .toEqual(createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[connector]));
        }
    });
});

describe('connectionParamsWithoutDraftRows', () => {
    const draftRows = { metadata: [{ key: 'x-tenant', value: '' }] };

    it('drops the draft rows of Hyper and Trino', () => {
        const hyper = { hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484', draftRows } } as unknown as ConnectionParams;
        const trino = { trino: { endpoint: 'http://trino', draftRows } } as unknown as ConnectionParams;
        expect(connectionParamsWithoutDraftRows(dql, hyper)).toEqual({ hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484' } });
        expect(connectionParamsWithoutDraftRows(dql, trino)).toEqual({ trino: { endpoint: 'http://trino' } });
        // The params of the caller stay as they are
        expect((hyper as { hyper: { draftRows?: unknown } }).hyper.draftRows).toBe(draftRows);
    });

    it('keeps the params of Salesforce as they are', () => {
        const params = { salesforce: { instanceUrl: 'https://example.my.salesforce.com', login: 'me' } } as unknown as ConnectionParams;
        expect(connectionParamsWithoutDraftRows(dql, params)).toEqual(params);
    });

    it('throws on params of an unknown connector', () => {
        expect(() => connectionParamsWithoutDraftRows(dql, { unknown: {} } as unknown as ConnectionParams)).toThrow(/unknown connector/);
    });
});

describe('connectionParamsHaveLoginHint', () => {
    it('reads the user of basic auth of Trino', () => {
        const trino = (username: string) => ({ trino: { endpoint: 'http://trino', auth: { authType: 'AUTH_BASIC', basic: { username } } } }) as unknown as ConnectionParams;
        expect(connectionParamsHaveLoginHint(dql, trino('me'))).toBe(true);
        expect(connectionParamsHaveLoginHint(dql, trino(''))).toBe(false);
    });

    it('reads the login of Salesforce and Database.com', () => {
        expect(connectionParamsHaveLoginHint(dql, { salesforce: { login: 'me' } } as unknown as ConnectionParams)).toBe(true);
        expect(connectionParamsHaveLoginHint(dql, { dbcom: { login: 'me' } } as unknown as ConnectionParams)).toBe(true);
        expect(connectionParamsHaveLoginHint(dql, { salesforce: { login: '' } } as unknown as ConnectionParams)).toBe(false);
    });

    it('finds none in Hyper params and without params', () => {
        expect(connectionParamsHaveLoginHint(dql, createDefaultConnectionParamsForConnector(dql, CONNECTOR_INFOS[ConnectorType.HYPER]))).toBe(false);
        expect(connectionParamsHaveLoginHint(dql, null)).toBe(false);
    });
});

describe('the databases of Salesforce connections', () => {
    it('names the catalog database and the Hyper Cloud database of Database.com', () => {
        expect(dql.salesforceCatalogDatabase()).toBe('lakehouse');
        expect(dql.hyperCloudDefaultDatabaseName()).toBe('default');
    });
});
