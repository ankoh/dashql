import { describe, expect, it } from 'vitest';

import { decodeConnectionFromProto } from './connection_import.js';
import { ConnectorType } from './connector_info.js';
import { LoggableException } from '../platform/logger/logger.js';

describe('decodeConnectionFromProto', () => {
    const cases = [
        ['salesforce', ConnectorType.SALESFORCE_DATA_CLOUD, { instanceUrl: 'https://example.my.salesforce.com' }],
        ['dbcom', ConnectorType.DBCOM, { databases: ['main'] }],
        ['hyper', ConnectorType.HYPER, { endpoint: 'http://127.0.0.1:7484' }],
        ['trino', ConnectorType.TRINO, { endpoint: 'http://127.0.0.1:8080', catalog: 'tpch' }],
    ] as const;

    for (const [key, connectorType, params] of cases) {
        it(`reads flat ${key} params as the setup params`, () => {
            expect(decodeConnectionFromProto({ [key]: params } as never, 'workbook')).toEqual({ connectorType, setupParams: params });
        });

        it(`reads the setup params of ${key} details`, () => {
            const proto = { setupTimings: { startedAt: 1 }, setupParams: params };
            expect(decodeConnectionFromProto({ [key]: proto } as never, 'workbook').setupParams).toBe(params);
        });

        it(`reads empty ${key} params`, () => {
            expect(decodeConnectionFromProto({ [key]: null } as never, 'workbook')).toEqual({ connectorType, setupParams: {} });
        });
    }

    it('rejects unknown connectors', () => {
        expect(() => decodeConnectionFromProto({ demo: {} } as never, 'workbook')).toThrow(LoggableException);
        expect(() => decodeConnectionFromProto({} as never, 'workbook')).toThrow('unsupported connection details');
    });
});
