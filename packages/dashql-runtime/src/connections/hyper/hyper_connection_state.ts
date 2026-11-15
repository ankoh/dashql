import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { DetailedError } from '../../utils/error.js';

// The runtime applies the steps of the setup of a Hyper connection (`packages/dashql-core-runtime/src/connections/hyper.rs`)

import { VariantKind } from '../../utils/variant.js';
import type { HyperDatabaseChannel } from './hyperdb_grpc_client.js';
import type { RESET_CONNECTION, DELETE_CONNECTION } from '../connection_state.js';

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
