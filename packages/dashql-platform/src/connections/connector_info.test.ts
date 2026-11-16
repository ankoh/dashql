import { describe, expect, it } from 'vitest';

import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';

describe('connector hello world scripts', () => {
    it.each([
        [ConnectorType.HYPER, 'select version();'],
        [ConnectorType.SALESFORCE_DATA_CLOUD, 'select version();'],
        [ConnectorType.TRINO, 'select version();'],
        [ConnectorType.DBCOM, 'select version();'],
    ])('defines an executable starter query for %s', (connectorType, expected) => {
        expect(CONNECTOR_INFOS[connectorType].helloWorldScript).toBe(expected);
    });
});
