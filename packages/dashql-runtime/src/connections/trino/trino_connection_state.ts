import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import type { DetailedError } from '../../utils/error.js';

import { VariantKind } from '../../utils/variant.js';
import { ConnectorType } from '../connector_info.js';
import type { ConnectionState, RESET_CONNECTION, DELETE_CONNECTION } from '../connection_state.js';
import type { TrinoChannelInterface } from "./trino_channel.js";

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

/// The details of a Trino connection, null for another connector
export function getTrinoConnectionDetails(state: ConnectionState | null): ConnectionState['details'] | null {
    return state?.connectorType === ConnectorType.TRINO ? state.details : null;
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
