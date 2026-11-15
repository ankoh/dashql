import { afterEach, describe, expect, it } from 'vitest';

import { CONNECTOR_INFOS, ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { useConnectorList } from './connector_list.js';

describe('connector list', () => {
    afterEach(() => {
        delete (globalThis as any).dashqlElectron;
    });

    it('shows the supported connectors in the browser', () => {
        expect(useConnectorList().map(info => info.connectorType)).toEqual([
            ConnectorType.HYPER,
            ConnectorType.DBCOM,
            ConnectorType.SALESFORCE_DATA_CLOUD,
            ConnectorType.TRINO,
        ]);
    });

    it('shows the supported connectors in Electron', () => {
        (globalThis as any).dashqlElectron = {};
        expect(useConnectorList().map(info => info.connectorType)).toEqual([
            ConnectorType.HYPER,
            ConnectorType.DBCOM,
            ConnectorType.SALESFORCE_DATA_CLOUD,
            ConnectorType.TRINO,
        ]);
        expect(useConnectorList()[0]).toBe(CONNECTOR_INFOS[ConnectorType.HYPER]);
    });
});
