import type * as core from '@ankoh/dashql-core';

import type { ConnectionState } from '../../connections/connection_state.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { createRuntime, type Runtime } from '../../runtime.js';
import { TASK_UPDATE_SCHEDULER } from '../../store/store.js';
import { TestLogger } from '../test_logger.js';

/// A runtime of a test without a platform beyond the core
export function testRuntime(dql: core.DashQL): Runtime {
    return createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: dql });
}

/// A new connection of a connector with setup params in the runtime
export function connectorState(runtime: Runtime, connectorType: ConnectorType, setupParams: unknown, connectionId = 'test'): ConnectionState {
    return runtime.createConnection({ connectorType, setupParams }, connectionId);
}
