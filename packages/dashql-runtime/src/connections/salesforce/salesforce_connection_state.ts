import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import type { DetailedError } from '../../utils/error.js';

import { VariantKind } from '../../utils/variant.js';
import { SalesforceDatabaseChannel } from './salesforce_api_client.js';
import { SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR } from '../connector_info.js';
import type { ConnectionState, DELETE_CONNECTION, RESET_CONNECTION } from '../connection_state.js';

/// The Salesforce connection state, the Rust connection of the runtime applies the actions of its setup
/// (`packages/dashql-runtime-rs/src/connections/salesforce.rs`)
export interface SalesforceConnectionStateDetails {
    /// The connection details
    proto: connection.SalesforceConnectionDetails;
    /// The Hyper connection
    channel: SalesforceDatabaseChannel | null;
}

/// Create the connection state details
export function createSalesforceConnectionStateDetails(params: connection.SalesforceConnectionParams): SalesforceConnectionStateDetails {
    return {
        proto: {
            setupTimings: {},
            setupParams: params
        },
        channel: null
    };
}

/// Unpack the connection state from the variant
export function getSalesforceConnectionDetails(state: ConnectionState | null): SalesforceConnectionStateDetails | null {
    if (state == null) return null;
    switch (state.details.type) {
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
        case DBCOM_CONNECTOR:
            return state.details.value;
        default: return null;
    }
}

export const SETUP_CANCELLED = Symbol('AUTH_CANCELLED');
export const SETUP_FAILED = Symbol('AUTH_FAILED');
export const SETUP_STARTED = Symbol('AUTH_STARTED');

export const SF_CHANNEL_SETUP_CANCELLED = Symbol('SF_CHANNEL_SETUP_CANCELLED');
export const SF_CHANNEL_SETUP_FAILED = Symbol('SF_CHANNEL_SETUP_FAILED');
export const SF_CHANNEL_SETUP_STARTED = Symbol('SF_CHANNEL_SETUP_STARTED');
export const SF_CHANNEL_READY = Symbol('SF_CHANNEL_READY');

export const GENERATING_PKCE_CHALLENGE = Symbol('GENERATING_PKCE_CHALLENGE');
export const GENERATED_PKCE_CHALLENGE = Symbol('GENERATED_PKCE_CHALLENGE');
export const OAUTH_NATIVE_LINK_OPENED = Symbol('OAUTH_NATIVE_LINK_OPENED');
export const OAUTH_WEB_WINDOW_CLOSED = Symbol('OAUTH_WEB_WINDOW_CLOSED');
export const OAUTH_WEB_WINDOW_OPENED = Symbol('OAUTH_WEB_WINDOW_OPENED');
export const RECEIVED_CORE_AUTH_CODE = Symbol('RECEIVED_AUTH_CODE');
export const REQUESTING_CORE_AUTH_TOKEN = Symbol('REQUESTING_CORE_AUTH_TOKEN');
export const RECEIVED_CORE_AUTH_TOKEN = Symbol('RECEIVED_CORE_ACCESS_TOKEN');
export const RECEIVED_CORE_USER_INFO = Symbol('RECEIVED_CORE_USER_INFO');
export const REQUESTING_DATA_CLOUD_ACCESS_TOKEN = Symbol('REQUESTING_DATA_CLOUD_ACCESS_TOKEN');
export const RECEIVED_DATA_CLOUD_ACCESS_TOKEN = Symbol('RECEIVED_DATA_CLOUD_ACCESS_TOKEN');

export type SalesforceConnectionStateAction =
    | VariantKind<typeof SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof SETUP_FAILED, DetailedError>
    | VariantKind<typeof SETUP_STARTED, connection.SalesforceConnectionParams>
    | VariantKind<typeof GENERATED_PKCE_CHALLENGE, auth.OAuthPKCEChallenge>
    | VariantKind<typeof GENERATING_PKCE_CHALLENGE, null>
    | VariantKind<typeof OAUTH_NATIVE_LINK_OPENED, null>
    | VariantKind<typeof OAUTH_WEB_WINDOW_CLOSED, null>
    | VariantKind<typeof OAUTH_WEB_WINDOW_OPENED, null>
    | VariantKind<typeof RECEIVED_CORE_AUTH_CODE, auth.TemporaryToken>
    | VariantKind<typeof RECEIVED_CORE_AUTH_TOKEN, connection.SalesforceCoreAccessToken>
    | VariantKind<typeof RECEIVED_CORE_USER_INFO, connection.SalesforceCoreUserInfo>
    | VariantKind<typeof RECEIVED_DATA_CLOUD_ACCESS_TOKEN, connection.SalesforceDataCloudAccessToken>
    | VariantKind<typeof REQUESTING_CORE_AUTH_TOKEN, null>
    | VariantKind<typeof REQUESTING_DATA_CLOUD_ACCESS_TOKEN, null>
    | VariantKind<typeof SF_CHANNEL_READY, SalesforceDatabaseChannel>
    | VariantKind<typeof SF_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof SF_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof SF_CHANNEL_SETUP_STARTED, connection.HyperConnectionParams>
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    ;
