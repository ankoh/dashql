import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { DetailedError } from '../../utils/error.js';

import { VariantKind } from '../../utils/variant.js';
import { HyperDatabaseChannel } from './hyperdb_grpc_client.js';
import type { RESET_CONNECTION, DELETE_CONNECTION } from '../connection_state.js';

/// The details of a Hyper connection, the Rust connection of the runtime applies the actions of its setup
/// (`packages/dashql-runtime-rs/src/connections/hyper.rs`)
export interface HyperConnectionDetails {
    /// The protobuf
    proto: connection.HyperConnectionDetails;
    /// The hyper channel
    channel: HyperDatabaseChannel | null;
}

export function createHyperConnectionStateDetails(params: connection.HyperConnectionParams): HyperConnectionDetails {
    return {
        proto: {
            setupTimings: {},
            setupParams: params,
        },
        channel: null
    };
}

export const HYPER_CHANNEL_SETUP_CANCELLED = Symbol('HYPER_CHANNEL_SETUP_CANCELLED');
export const HYPER_CHANNEL_SETUP_FAILED = Symbol('HYPER_CHANNEL_SETUP_FAILED');
export const HYPER_CHANNEL_SETUP_STARTED = Symbol('HYPER_CHANNEL_SETUP_STARTED');
export const HYPER_CHANNEL_READY = Symbol('HYPER_CHANNEL_READY');

export type HyperConnectorAction =
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_STARTED, connection.HyperConnectionParams>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof HYPER_CHANNEL_READY, [HyperDatabaseChannel, connection.HyperConnectionParams]>
    ;
