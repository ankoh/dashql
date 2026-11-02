import type * as auth from '@ankoh/dashql-jsonschema/auth.js';
import { expect, vi } from 'vitest';

import { ConnectionHealth, ConnectionStatus, type ConnectionState } from '../../connections/connection_state.js';
import type { DetailedError } from '../../utils/error.js';

/// A connection state with only the fields that the reducers of the connectors read: statuses and details
export function connectorState(type: symbol, details: unknown): ConnectionState {
    return {
        connectionId: 'test',
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        details: { type, value: details },
    } as unknown as ConnectionState;
}

/// Apply a connector action that the reducer has to handle
export function reduceConnector<A>(reduce: (state: ConnectionState, action: A) => ConnectionState | null, state: ConnectionState, action: A): ConnectionState {
    const next = reduce(state, action);
    expect(next).not.toBeNull();
    return next!;
}

/// A channel that only records that it was closed
export function fakeChannel<T>(): T & { close: ReturnType<typeof vi.fn> } {
    return { close: vi.fn() } as unknown as T & { close: ReturnType<typeof vi.fn> };
}

export const TEST_ERROR = { message: 'boom' } as DetailedError;
export const TEST_PKCE = { value: 'challenge', verifier: 'verifier' } as auth.OAuthPKCEChallenge;
export const TEST_AUTH_CODE = { token: 'code', createdAt: '2026-01-01T00:00:00.000Z' } as auth.TemporaryToken;
