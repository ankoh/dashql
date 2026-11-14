import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { ConnectionState } from './connection_state.js';
import { isSalesforceDetails } from './connection_state_details.js';

export enum ConnectionSetupCheck {
    UNKNOWN,
    CONNECTION_NULL,
    CONNECTION_TYPE_MISMATCH,
    AUTHENTICATED,
    AUTHENTICATION_FAILED,
    AUTHENTICATION_IN_PROGRESS,
    AUTHENTICATION_NOT_STARTED,
    CLIENT_ID_MISMATCH,
}

export function checkSalesforceConnectionSetup(
    state: ConnectionState | null,
    params: connection.SalesforceConnectionParams,
): ConnectionSetupCheck {
    if (!state) {
        return ConnectionSetupCheck.CONNECTION_NULL;
    }
    if (!isSalesforceDetails(state.details)) {
        return ConnectionSetupCheck.CONNECTION_TYPE_MISMATCH;
    }
    const details = state.details.value;
    if (!details.proto.setupParams) {
        return ConnectionSetupCheck.AUTHENTICATION_NOT_STARTED;
    }
    if (details.proto.setupParams.appConsumerKey != params.appConsumerKey) {
        return ConnectionSetupCheck.CLIENT_ID_MISMATCH;
    }
    if (details.proto.setupError) {
        return ConnectionSetupCheck.AUTHENTICATION_FAILED;
    }
    const coreToken = details.proto.oauthState?.coreAccessToken;
    const token = details.proto.oauthState?.dataCloudAccessToken;
    if (coreToken?.accessToken && token?.jwt?.raw) {
        return ConnectionSetupCheck.AUTHENTICATED;
    }
    if (details.proto.setupTimings?.authStartedAt) {
        return ConnectionSetupCheck.AUTHENTICATION_IN_PROGRESS;
    }
    return ConnectionSetupCheck.UNKNOWN;
}

export function checkHyperConnectionSetup(
    state: ConnectionState | null,
    params: connection.HyperConnectionParams,
): ConnectionSetupCheck {
    return ConnectionSetupCheck.UNKNOWN;
}
