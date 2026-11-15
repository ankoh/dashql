import type { ConnectionDispatch } from './connection_registry_state.js';
import { HEALTH_CHECK_CANCELLED, HEALTH_CHECK_FAILED, HEALTH_CHECK_STARTED, HEALTH_CHECK_SUCCEEDED, type ConnectionAction } from './connection_state.js';
import type { HyperDatabaseChannel } from './hyper/hyperdb_grpc_client.js';
import type { QueryExecutor } from './query_execution_args.js';
import { QueryType } from '../query/query_execution_state.js';
import type { SalesforceDatabaseChannel } from './salesforce/salesforce_api_client.js';
import type { TrinoChannelInterface } from './trino/trino_channel.js';
import { loadSetupCore, SetupRun } from './connection_setup_native.js';
import type { Logger } from '../platform/logger/logger.js';

export type HealthCheckChannel =
    | { type: 'hyper'; channel: HyperDatabaseChannel }
    | { type: 'salesforce'; channel: SalesforceDatabaseChannel }
    | { type: 'trino'; channel: TrinoChannelInterface };

/// The actions of the health check by their names in the Rust runtime
const ACTIONS: Record<string, ConnectionAction['type']> = {
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_SUCCEEDED,
};

/// A logger for the run of a health check, it logs nothing of its own
const SILENT: Logger = new Proxy({}, { get: () => () => { } }) as unknown as Logger;

/// Run the connection's health check through the query executor so the probe shows up in the internals query viewer
/// like any other query. The caller passes the channel it already holds locally after setup, we don't wait for the
/// React state update that publishes the channel into the connection map.
///
/// The check runs in the Rust runtime (`connection_setup/health_check.rs`): it dispatches HEALTH_CHECK_STARTED, runs
/// the probe of the connector and maps the outcome to HEALTH_CHECK_SUCCEEDED / FAILED / CANCELLED. It rethrows on
/// non-success so callers keep their existing try/catch semantics. A failed probe rethrows the error of the query,
/// e.g. the status of a rejected login.
export async function performHealthCheck(
    executor: QueryExecutor,
    connectionId: string,
    channel: HealthCheckChannel,
    dispatch: ConnectionDispatch,
    abortSignal: AbortSignal,
): Promise<void> {
    const core = await loadSetupCore();
    const run = new SetupRun({
        logger: SILENT,
        signal: abortSignal,
        dispatch: action => {
            const type = ACTIONS[action.type];
            if (type != null) dispatch({ type, value: action.value } as ConnectionAction);
        },
        runProbe: async (probeChannel, query, metadata) => {
            const [, execution] = executor(connectionId, {
                query,
                analyzeResults: false,
                metadata: {
                    queryType: QueryType.HEALTH_CHECK,
                    title: metadata.title ?? 'Health Check',
                    description: null,
                    issuer: metadata.issuer ?? 'Connection Setup',
                    userProvided: false,
                },
                channelOverride: probeChannel as HealthCheckChannel,
                throwOnError: true,
            });
            return (await execution) != null;
        },
    });
    const id = run.registerChannel(channel);
    try {
        await run.result(core.connectionSetup.healthCheck(run.host(), channel.type, id), 'health_check');
    } catch (error) {
        if (abortSignal.aborted) {
            const abortError: Error & { name: string } = new Error('health check cancelled');
            abortError.name = 'AbortError';
            throw abortError;
        }
        throw error;
    }
}
