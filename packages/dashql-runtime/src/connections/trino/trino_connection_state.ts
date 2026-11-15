import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import type { DetailedError } from '../../utils/error.js';

import { VariantKind } from '../../utils/variant.js';
import { TRINO_CONNECTOR } from '../connector_info.js';
import type { ConnectionState, RESET_CONNECTION, DELETE_CONNECTION } from '../connection_state.js';
import { TrinoChannelInterface } from "./trino_channel.js";

// The Rust connection of the runtime applies the actions of the setup
// (`packages/dashql-core-runtime/src/connections/trino.rs`)

// OAuth flow action symbols
export const OAUTH_STARTED = Symbol('OAUTH_STARTED');
export const OAUTH_CANCELLED = Symbol('OAUTH_CANCELLED');
export const OAUTH_FAILED = Symbol('OAUTH_FAILED');
export const GENERATING_PKCE_CHALLENGE = Symbol('GENERATING_PKCE_CHALLENGE');
export const GENERATED_PKCE_CHALLENGE = Symbol('GENERATED_PKCE_CHALLENGE');
export const OAUTH_BROWSER_OPENED = Symbol('OAUTH_BROWSER_OPENED');
export const RECEIVED_OAUTH_CODE = Symbol('RECEIVED_OAUTH_CODE');
export const REQUESTING_ACCESS_TOKEN = Symbol('REQUESTING_ACCESS_TOKEN');
export const RECEIVED_ACCESS_TOKEN = Symbol('RECEIVED_ACCESS_TOKEN');

export interface TrinoConnectionStateDetails {
    /// The proto
    proto: connection.TrinoConnectionDetails;
    /// The channel
    channel: TrinoChannelInterface | null;
}

export function createTrinoConnectionStateDetails(params: connection.TrinoConnectionParams): TrinoConnectionStateDetails {
    return {
        proto: {
            setupTimings: {},
            setupParams: params,
        },
        channel: null
    };
}

export function getTrinoConnectionDetails(state: ConnectionState | null): TrinoConnectionStateDetails | null {
    if (state == null) return null;
    switch (state.details.type) {
        case TRINO_CONNECTOR: return state.details.value;
        default: return null;
    }
}

export const TRINO_CHANNEL_SETUP_CANCELLED = Symbol('TRINO_CHANNEL_SETUP_CANCELLED');
export const TRINO_CHANNEL_SETUP_FAILED = Symbol('TRINO_CHANNEL_SETUP_FAILED');
export const TRINO_CHANNEL_SETUP_STARTED = Symbol('TRINO_CHANNEL_SETUP_STARTED');
export const TRINO_CHANNEL_READY = Symbol('TRINO_CHANNEL_READY');

export type TrinoConnectorAction =
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    // OAuth flow actions
    | VariantKind<typeof OAUTH_STARTED, connection.TrinoConnectionParams>
    | VariantKind<typeof OAUTH_CANCELLED, DetailedError>
    | VariantKind<typeof OAUTH_FAILED, DetailedError>
    | VariantKind<typeof GENERATING_PKCE_CHALLENGE, null>
    | VariantKind<typeof GENERATED_PKCE_CHALLENGE, auth.OAuthPKCEChallenge>
    | VariantKind<typeof OAUTH_BROWSER_OPENED, null>
    | VariantKind<typeof RECEIVED_OAUTH_CODE, auth.TemporaryToken>
    | VariantKind<typeof REQUESTING_ACCESS_TOKEN, null>
    | VariantKind<typeof RECEIVED_ACCESS_TOKEN, connection.TrinoAccessToken>
    // Channel setup actions
    | VariantKind<typeof TRINO_CHANNEL_SETUP_STARTED, connection.TrinoConnectionParams>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof TRINO_CHANNEL_READY, TrinoChannelInterface>
    // Health check actions
    ;
