import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { DetailedError } from '../connection_types.js';
import type { VariantKind } from '../../../../utils/variant.js';
import type { Hasher } from '../../../../utils/hash.js';
import type { StorageWriter } from '../../persistence/storage_writer.js';
import type { ConnectionSignatureMap } from '../connection_signature.js';
import type { ConnectionState, ConnectionStateWithoutId } from '../connection_state.js';
import { DefaultHasher } from '../../../../utils/hash_default.js';
import { dateToTimestamp } from '../proto_helper.js';
import { updateConnectionSignature } from '../connection_signature.js';
import { CONNECTOR_INFOS, ConnectorType, DUCKDB_CONNECTOR } from '../connector_info.js';
import { EmbeddedDatabaseChannel } from '../embedded/embedded_database_channel.js';
import {
    ConnectionHealth,
    ConnectionStatus,
    createConnectionState,
    DELETE_CONNECTION,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_SUCCEEDED,
    RESET_CONNECTION,
} from '../connection_state.js';
import type * as dashql from '../../../../core/index.js';

export interface DuckDBConnectionDetails {
    proto: connection.DuckDBConnectionDetails;
    channel: EmbeddedDatabaseChannel | null;
}

export function createDuckDBConnectionStateDetails(
    params: connection.DuckDBConnectionParams = {},
): DuckDBConnectionDetails {
    return {
        proto: { setupTimings: {}, setupParams: params },
        channel: null,
    };
}

export function createDuckDBConnectionState(
    dql: dashql.DashQL,
    connSigs: ConnectionSignatureMap,
): ConnectionStateWithoutId {
    return createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.DUCKDB], connSigs, {
        type: DUCKDB_CONNECTOR,
        value: createDuckDBConnectionStateDetails(),
    });
}

export function getDuckDBConnectionDetails(state: ConnectionState | null): DuckDBConnectionDetails | null {
    return state?.details.type === DUCKDB_CONNECTOR ? state.details.value : null;
}

export function computeDuckDBConnectionSignature(_details: DuckDBConnectionDetails, hasher: Hasher): void {
    hasher.add('duckdb');
}

export const DUCKDB_CHANNEL_SETUP_CANCELLED = Symbol('DUCKDB_CHANNEL_SETUP_CANCELLED');
export const DUCKDB_CHANNEL_SETUP_FAILED = Symbol('DUCKDB_CHANNEL_SETUP_FAILED');
export const DUCKDB_CHANNEL_SETUP_STARTED = Symbol('DUCKDB_CHANNEL_SETUP_STARTED');
export const DUCKDB_CHANNEL_READY = Symbol('DUCKDB_CHANNEL_READY');

export type DuckDBConnectorAction =
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof DUCKDB_CHANNEL_SETUP_STARTED, connection.DuckDBConnectionParams>
    | VariantKind<typeof DUCKDB_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof DUCKDB_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof DUCKDB_CHANNEL_READY, EmbeddedDatabaseChannel>
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, null>
    | VariantKind<typeof HEALTH_CHECK_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>;

export function reduceDuckDBConnectorState(
    state: ConnectionState,
    action: DuckDBConnectorAction,
    _storage: StorageWriter,
): ConnectionState | null {
    const details = state.details.value as DuckDBConnectionDetails;
    switch (action.type) {
        case DELETE_CONNECTION:
        case RESET_CONNECTION:
            void details.channel?.close();
            return {
                ...state,
                details: {
                    type: DUCKDB_CONNECTOR,
                    value: {
                        ...details,
                        proto: { ...details.proto, setupTimings: {}, channelError: undefined, healthCheckError: undefined },
                        channel: null,
                    },
                },
            };
        case DUCKDB_CHANNEL_SETUP_STARTED: {
            const nextDetails = createDuckDBConnectionStateDetails(action.value);
            nextDetails.proto.setupTimings.channelSetupStartedAt = dateToTimestamp(new Date());
            const signature = new DefaultHasher();
            computeDuckDBConnectionSignature(nextDetails, signature);
            return {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: { type: DUCKDB_CONNECTOR, value: nextDetails },
                connectionSignature: updateConnectionSignature(state.connectionSignature, signature, state.notebookId),
            };
        }
        case DUCKDB_CHANNEL_SETUP_CANCELLED:
            return updateDuckDBFailure(state, details, ConnectionStatus.CHANNEL_SETUP_CANCELLED, ConnectionHealth.CANCELLED, 'channelSetupCancelledAt', action.value);
        case DUCKDB_CHANNEL_SETUP_FAILED:
            return updateDuckDBFailure(state, details, ConnectionStatus.CHANNEL_SETUP_FAILED, ConnectionHealth.FAILED, 'channelSetupFailedAt', action.value);
        case DUCKDB_CHANNEL_READY:
            return {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: DUCKDB_CONNECTOR,
                    value: {
                        ...details,
                        proto: {
                            ...details.proto,
                            setupTimings: { ...details.proto.setupTimings, channelReadyAt: dateToTimestamp(new Date()) },
                        },
                        channel: action.value,
                    },
                },
            };
        case HEALTH_CHECK_STARTED:
            return updateDuckDBHealth(state, details, ConnectionStatus.HEALTH_CHECK_STARTED, ConnectionHealth.CONNECTING, 'healthCheckStartedAt');
        case HEALTH_CHECK_CANCELLED:
            return updateDuckDBHealth(state, details, ConnectionStatus.HEALTH_CHECK_CANCELLED, ConnectionHealth.CANCELLED, 'healthCheckCancelledAt');
        case HEALTH_CHECK_FAILED:
            return updateDuckDBHealth(state, details, ConnectionStatus.HEALTH_CHECK_FAILED, ConnectionHealth.FAILED, 'healthCheckFailedAt', action.value);
        case HEALTH_CHECK_SUCCEEDED:
            return updateDuckDBHealth(state, details, ConnectionStatus.HEALTH_CHECK_SUCCEEDED, ConnectionHealth.ONLINE, 'healthCheckSucceededAt');
    }
}

type SetupTimingKey = keyof connection.SetupTimings;

function updateDuckDBFailure(
    state: ConnectionState,
    details: DuckDBConnectionDetails,
    connectionStatus: ConnectionStatus,
    connectionHealth: ConnectionHealth,
    timing: SetupTimingKey,
    error: DetailedError,
): ConnectionState {
    return {
        ...state,
        connectionStatus,
        connectionHealth,
        details: {
            type: DUCKDB_CONNECTOR,
            value: {
                ...details,
                proto: {
                    ...details.proto,
                    setupTimings: { ...details.proto.setupTimings, [timing]: dateToTimestamp(new Date()) },
                    channelError: error,
                },
                channel: null,
            },
        },
    };
}

function updateDuckDBHealth(
    state: ConnectionState,
    details: DuckDBConnectionDetails,
    connectionStatus: ConnectionStatus,
    connectionHealth: ConnectionHealth,
    timing: SetupTimingKey,
    error?: DetailedError,
): ConnectionState {
    return {
        ...state,
        connectionStatus,
        connectionHealth,
        details: {
            type: DUCKDB_CONNECTOR,
            value: {
                ...details,
                proto: {
                    ...details.proto,
                    setupTimings: { ...details.proto.setupTimings, [timing]: dateToTimestamp(new Date()) },
                    healthCheckError: error,
                },
            },
        },
    };
}
