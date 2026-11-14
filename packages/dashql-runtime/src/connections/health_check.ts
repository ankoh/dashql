import type { ConnectionDispatch } from './connection_registry_state.js';
import { HEALTH_CHECK_CANCELLED, HEALTH_CHECK_FAILED, HEALTH_CHECK_STARTED, HEALTH_CHECK_SUCCEEDED } from './connection_state.js';
import type { DetailedError } from '../utils/error.js';
import { LoggableException } from '../platform/logger/logger.js';
import type { HyperDatabaseChannel } from './hyper/hyperdb_grpc_client.js';
import type { QueryExecutor } from './query_execution_args.js';
import { QueryType } from '../query/query_execution_state.js';
import type { SalesforceDatabaseChannel } from './salesforce/salesforce_api_client.js';
import type { TrinoChannelInterface } from './trino/trino_channel.js';

export type HealthCheckChannel =
    | { type: 'hyper'; channel: HyperDatabaseChannel }
    | { type: 'salesforce'; channel: SalesforceDatabaseChannel }
    | { type: 'trino'; channel: TrinoChannelInterface };

function pickProbeQuery(channel: HealthCheckChannel): string {
    switch (channel.type) {
        case 'trino':
            return 'select 1';
        case 'hyper':
        case 'salesforce':
            return 'select 1 as healthy';
    }
}

function toDetailedError(error: unknown): DetailedError {
    // The status of a failed request or the message of the database
    if (error instanceof LoggableException) {
        const data = Object.fromEntries(Object.entries(error.keyValues).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        return Object.keys(data).length > 0 ? { message: error.message, data } : { message: error.message };
    }
    if (error instanceof Error) {
        return { message: error.message };
    }
    if (error != null && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
        return { message: (error as { message: string }).message };
    }
    return { message: String(error ?? 'health check failed') };
}

/// Run the connection's health check through the query executor so the probe shows up
/// in the internals query viewer like any other query. The caller passes the channel
/// it already holds locally after setup — we don't wait for the React state update
/// that publishes the channel into the connection map.
///
/// Dispatches HEALTH_CHECK_STARTED before the first await, then maps the outcome to
/// HEALTH_CHECK_SUCCEEDED / FAILED / CANCELLED and rethrows on non-success so callers
/// keep their existing try/catch semantics. A failed probe rethrows the error of the query, e.g. the status of a
/// rejected login.
export async function performHealthCheck(
    executor: QueryExecutor,
    connectionId: string,
    channel: HealthCheckChannel,
    dispatch: ConnectionDispatch,
    abortSignal: AbortSignal,
): Promise<void> {
    dispatch({ type: HEALTH_CHECK_STARTED, value: null });
    abortSignal.throwIfAborted();

    const [, execution] = executor(connectionId, {
        query: pickProbeQuery(channel),
        analyzeResults: false,
        metadata: {
            queryType: QueryType.HEALTH_CHECK,
            title: 'Health Check',
            description: null,
            issuer: 'Connection Setup',
            userProvided: false,
        },
        channelOverride: channel,
        throwOnError: true,
    });
    const cancelled = () => {
        dispatch({ type: HEALTH_CHECK_CANCELLED, value: null });
        const abortError: Error & { name: string } = new Error('health check cancelled');
        abortError.name = 'AbortError';
        return abortError;
    };
    let table: Awaited<typeof execution>;
    try {
        table = await execution;
    } catch (error) {
        if (abortSignal.aborted) throw cancelled();
        dispatch({ type: HEALTH_CHECK_FAILED, value: toDetailedError(error) });
        throw error;
    }

    if (abortSignal.aborted) {
        throw cancelled();
    }
    if (table == null) {
        const detailed: DetailedError = { message: 'health check failed' };
        dispatch({ type: HEALTH_CHECK_FAILED, value: detailed });
        throw new Error(detailed.message);
    }
    dispatch({ type: HEALTH_CHECK_SUCCEEDED, value: null });
}
