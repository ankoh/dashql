import { afterEach, describe, expect, it } from 'vitest';

import { CONNECTOR_INFOS, ConnectorType, useConnectorList } from './connector_info.js';

describe('connector list', () => {
    afterEach(() => {
        delete (globalThis as any).__TAURI_INTERNALS__;
    });

    it('shows Hyper first and omits DuckDB in the browser', () => {
        expect(useConnectorList().map(info => info.connectorType)).toEqual([
            ConnectorType.HYPER,
            ConnectorType.SALESFORCE_DATA_CLOUD,
            ConnectorType.TRINO,
        ]);
        expect(CONNECTOR_INFOS[ConnectorType.DUCKDB].platforms.browser).toBe(false);
    });

    it('shows DuckDB first in Tauri', () => {
        (globalThis as any).__TAURI_INTERNALS__ = {};
        expect(useConnectorList().map(info => info.connectorType)).toEqual([
            ConnectorType.DUCKDB,
            ConnectorType.HYPER,
            ConnectorType.SALESFORCE_DATA_CLOUD,
            ConnectorType.TRINO,
        ]);
    });
});

describe('connector hello world scripts', () => {
    it.each([
        [ConnectorType.HYPER, 'select version();'],
        [ConnectorType.DUCKDB, 'select version();'],
        [ConnectorType.SALESFORCE_DATA_CLOUD, 'select version();'],
        [ConnectorType.TRINO, 'select version();'],
    ])('defines an executable starter query for %s', (connectorType, expected) => {
        expect(CONNECTOR_INFOS[connectorType].helloWorldScript).toBe(expected);
    });
});
