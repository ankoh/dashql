import * as pb from '@ankoh/dashql-protobuf';

import { ConnectionState } from './connection_state.js';
import { SALESFORCE_DATA_CLOUD_CONNECTOR } from './connector_info.js';

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
    params: pb.dashql.connection.SalesforceConnectionParams,
): ConnectionSetupCheck {
    if (!state) {
        return ConnectionSetupCheck.CONNECTION_NULL;
    }
    if (state?.details.type != SALESFORCE_DATA_CLOUD_CONNECTOR) {
        return ConnectionSetupCheck.CONNECTION_TYPE_MISMATCH;
    }
    const details = state.details.value;
    if (!details.setupParams) {
        return ConnectionSetupCheck.AUTHENTICATION_NOT_STARTED;
    }
    if (details.setupParams.appConsumerKey != params.appConsumerKey) {
        return ConnectionSetupCheck.CLIENT_ID_MISMATCH;
    }
    if (details.dataCloudAccessToken) {
        return ConnectionSetupCheck.AUTHENTICATED;
    }
    if (details.setupTimings.authStartedAt) {
        return ConnectionSetupCheck.AUTHENTICATION_IN_PROGRESS;
    }
    if (details.setupError) {
        return ConnectionSetupCheck.AUTHENTICATION_FAILED;
    }
    return ConnectionSetupCheck.UNKNOWN;
}

export function checkHyperConnectionSetup(
    state: ConnectionState | null,
    params: pb.dashql.connection.HyperConnectionParams,
): ConnectionSetupCheck {
    return ConnectionSetupCheck.UNKNOWN;
}
