import type * as core from '@ankoh/dashql-core';

import type { ConnectionState } from '@ankoh/dashql-platform/connections/connection_state';
import { ConnectorType } from '@ankoh/dashql-platform/connections/connector_info';
import { createRuntime, type Runtime } from '../../runtime.js';
import { TASK_UPDATE_SCHEDULER } from '../../store/store.js';
import { TestLogger } from '@ankoh/dashql-platform/testing/test_logger';

/// A runtime of a test without a platform beyond the core
export function testRuntime(dql: core.DashQL): Runtime {
    return createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: dql });
}

/// A new connection of a connector with setup params in the runtime
export function connectorState(runtime: Runtime, connectorType: ConnectorType, setupParams: unknown, connectionId = 'test'): ConnectionState {
    return runtime.createConnection({ connectorType, setupParams }, connectionId);
}
