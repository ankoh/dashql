import type * as auth from '@ankoh/dashql-jsonschema/auth.js';
import type * as core from '@ankoh/dashql-core';
import { vi } from 'vitest';

import { createConnectionState, reduceConnectionState, type ConnectionAction, type ConnectionState } from '../../connections/connection_state.js';
import type { ConnectionStateDetailsVariant } from '../../connections/connection_state_details.js';
import { CONNECTOR_INFOS, ConnectorType, DBCOM_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from '../../connections/connector_info.js';
import type { DetailedError } from '../../utils/error.js';
import { TestLogger } from '../test_logger.js';

const CONNECTOR_TYPES = new Map<symbol, ConnectorType>([
    [HYPER_CONNECTOR, ConnectorType.HYPER],
    [SALESFORCE_DATA_CLOUD_CONNECTOR, ConnectorType.SALESFORCE_DATA_CLOUD],
    [TRINO_CONNECTOR, ConnectorType.TRINO],
    [DBCOM_CONNECTOR, ConnectorType.DBCOM],
]);

/// The state of a new connection of a connector with the setup params of its details, on the Rust connection of the
/// core
export function connectorState(dql: core.DashQL, type: symbol, details: unknown): ConnectionState {
    const connectorType = CONNECTOR_TYPES.get(type)!;
    const variant = { type, value: details } as ConnectionStateDetailsVariant;
    return { ...createConnectionState(dql, CONNECTOR_INFOS[connectorType], variant), connectionId: 'test' };
}

/// Apply a connector action
export function reduceConnector<A>(state: ConnectionState, action: A): ConnectionState {
    return reduceConnectionState(state, action as unknown as ConnectionAction, new TestLogger());
}

/// A channel that only records that it was closed
export function fakeChannel<T>(): T & { close: ReturnType<typeof vi.fn> } {
    return { close: vi.fn() } as unknown as T & { close: ReturnType<typeof vi.fn> };
}

export const TEST_ERROR = { message: 'boom' } as DetailedError;
export const TEST_PKCE = { value: 'challenge', verifier: 'verifier' } as auth.OAuthPKCEChallenge;
export const TEST_AUTH_CODE = { token: 'code', createdAt: '2026-01-01T00:00:00.000Z' } as auth.TemporaryToken;
