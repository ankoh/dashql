import { describe, it, expect } from 'vitest';
import { createAttachedConnectionParamsForConnector, createDefaultConnectionParamsForConnector, DEFAULT_HYPER_ENDPOINT } from './connection_params.js';
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
