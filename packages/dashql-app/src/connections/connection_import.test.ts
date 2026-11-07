import { describe, expect, it } from 'vitest';

import { decodeConnectionFromProto } from './connection_import.js';
import { ConnectorType, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
import { LoggableException } from '../platform/logger/logger.js';

describe('decodeConnectionFromProto', () => {
    const cases = [
        ['salesforce', ConnectorType.SALESFORCE_DATA_CLOUD, SALESFORCE_DATA_CLOUD_CONNECTOR, { instanceUrl: 'https://example.my.salesforce.com' }],
        ['dbcom', ConnectorType.DBCOM, DBCOM_CONNECTOR, { databases: ['main'] }],
        ['hyper', ConnectorType.HYPER, HYPER_CONNECTOR, { endpoint: 'http://127.0.0.1:7484' }],
        ['trino', ConnectorType.TRINO, TRINO_CONNECTOR, { endpoint: 'http://127.0.0.1:8080', catalog: 'tpch' }],
    ] as const;

    for (const [key, connectorType, detailsType, params] of cases) {
        it(`wraps flat ${key} params into the setup params`, () => {
            const [info, details] = decodeConnectionFromProto({ [key]: params } as never, 'session');
            expect(info.connectorType).toBe(connectorType);
            expect(details.type).toBe(detailsType);
            expect(details.value).toEqual({ proto: { setupTimings: {}, setupParams: params }, channel: null });
        });

        it(`keeps ${key} details that carry their setup params`, () => {
            const proto = { setupTimings: { startedAt: 1 }, setupParams: params };
            const [, details] = decodeConnectionFromProto({ [key]: proto } as never, 'session');
            expect(details.type).toBe(detailsType);
            expect((details.value as { proto: unknown }).proto).toBe(proto);
        });

        it(`reads empty ${key} params`, () => {
            const [, details] = decodeConnectionFromProto({ [key]: null } as never, 'session');
            expect((details.value as { proto: unknown }).proto).toEqual({ setupTimings: {}, setupParams: {} });
        });
    }

    it('rejects unknown connectors', () => {
        expect(() => decodeConnectionFromProto({ demo: {} } as never, 'session')).toThrow(LoggableException);
        expect(() => decodeConnectionFromProto({} as never, 'session')).toThrow('unsupported connection details');
    });
});
