import type * as auth from '@ankoh/dashql-jsonschema/auth.js';
import type * as core from '@ankoh/dashql-core';
import { vi } from 'vitest';

import type { ConnectionAction, ConnectionState } from '../../connections/connection_state.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { CoreRuntime } from '../../core_runtime.js';
import { TASK_UPDATE_SCHEDULER } from '../../store/store.js';
import type { DetailedError } from '../../utils/error.js';
import { TestLogger } from '../test_logger.js';

/// A runtime of the module of a test without a platform beyond the core
export function testCoreRuntime(dql: core.DashQL): CoreRuntime {
    return new CoreRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: dql });
}

/// A new connection of a connector with setup params in the runtime
export function connectorState(runtime: CoreRuntime, connectorType: ConnectorType, setupParams: unknown, connectionId = 'test'): ConnectionState {
    return runtime.createConnection({ connectorType, setupParams }, connectionId);
}

/// Apply a connector action, throws if the runtime refused it. A deleted connection is null.
export function reduceConnector<A>(runtime: CoreRuntime, state: Pick<ConnectionState, 'connectionId'>, action: A): ConnectionState | null {
    const outcome = runtime.dispatchConnection(state.connectionId, action as unknown as ConnectionAction);
    if (!outcome.ok) throw new Error(outcome.error ?? 'the action was refused');
    runtime.flush();
    return runtime.connection(state.connectionId);
}

/// A channel that only records that it was closed
export function fakeChannel<T>(): T & { close: ReturnType<typeof vi.fn> } {
    return { close: vi.fn() } as unknown as T & { close: ReturnType<typeof vi.fn> };
}

export const TEST_ERROR = { message: 'boom' } as DetailedError;
export const TEST_PKCE = { value: 'challenge', verifier: 'verifier' } as auth.OAuthPKCEChallenge;
export const TEST_AUTH_CODE = { token: 'code', createdAt: '2026-01-01T00:00:00.000Z' } as auth.TemporaryToken;
