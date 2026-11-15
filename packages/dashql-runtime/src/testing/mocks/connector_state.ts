import type * as core from '@ankoh/dashql-core';

import type { ConnectionState } from '../../connections/connection_state.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { CoreRuntime } from '../../core_runtime.js';
import { TASK_UPDATE_SCHEDULER } from '../../store/store.js';
import { TestLogger } from '../test_logger.js';

/// A runtime of the module of a test without a platform beyond the core
export function testCoreRuntime(dql: core.DashQL): CoreRuntime {
    return new CoreRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: dql });
}

/// A new connection of a connector with setup params in the runtime
export function connectorState(runtime: CoreRuntime, connectorType: ConnectorType, setupParams: unknown, connectionId = 'test'): ConnectionState {
    return runtime.createConnection({ connectorType, setupParams }, connectionId);
}
