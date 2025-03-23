import * as dashql from '@ankoh/dashql-core';

import { PKCEChallenge } from '../../utils/pkce.js';
import { VariantKind } from '../../utils/variant.js';
import {
    SalesforceCoreAccessToken,
    SalesforceDatabaseChannel,
    SalesforceDataCloudAccessToken,
} from './salesforce_api_client.js';
import { SalesforceConnectionParams } from './salesforce_connection_params.js';
import { CONNECTOR_INFOS, ConnectorType, SALESFORCE_DATA_CLOUD_CONNECTOR } from '../connector_info.js';
import {
    ConnectionHealth,
    ConnectionState,
    ConnectionStateWithoutId,
    ConnectionStatus,
    createConnectionState,
    RESET,
} from '../connection_state.js';
import {
    CHANNEL_READY,
    CHANNEL_SETUP_CANCELLED,
    CHANNEL_SETUP_FAILED,
    CHANNEL_SETUP_STARTED,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_SUCCEEDED,
    HyperGrpcSetupTimings
} from '../hyper/hyper_connection_state.js';
import { HyperGrpcConnectionParams } from '../hyper/hyper_connection_params.js';
import { DetailedError } from 'utils/error.js';

export interface SalesforceSetupTimings extends HyperGrpcSetupTimings {
    /// The time when the auth started
    authStartedAt: Date | null;
    /// The time when the auth got cancelled
    authCancelledAt: Date | null;
    /// The time when the auth failed
    authFailedAt: Date | null;

    /// The time when the PKCE generation started
    pkceGenStartedAt: Date | null;
    /// The time when the PKCE generation finished
    pkceGenFinishedAt: Date | null;
    /// The time when the auth link was opened
    openedNativeAuthLinkAt: Date | null;
    /// The time when the auth window was opened
    openedWebAuthWindowAt: Date | null;
    /// The time when the auth window was closed
    closedWebAuthWindowAt: Date | null;
    /// The time when we received the oauth code
    oauthCodeReceivedAt: Date | null;
    /// The time when we started to request the core access token
    coreAccessTokenRequestedAt: Date | null;
    /// The time when we received the core access token
    coreAccessTokenReceivedAt: Date | null;
    /// The time when we started to request the data cloud access token
    dataCloudAccessTokenRequestedAt: Date | null;
    /// The time when we received the data cloud access token
    dataCloudAccessTokenReceivedAt: Date | null;

    /// The time when we started to request the data cloud metadata
    dataCloudMetadataRequestedAt: Date | null;
    /// The time when we received the data cloud metadata
    dataCloudMetadataReceivedAt: Date | null;
}

export function createSalesforceSetupTimings(): SalesforceSetupTimings {
    return {
        authCancelledAt: null,
        authFailedAt: null,
        authStartedAt: null,

        pkceGenStartedAt: null,
        pkceGenFinishedAt: null,
        openedNativeAuthLinkAt: null,
        openedWebAuthWindowAt: null,
        closedWebAuthWindowAt: null,
        oauthCodeReceivedAt: null,
        coreAccessTokenRequestedAt: null,
        coreAccessTokenReceivedAt: null,
        dataCloudAccessTokenRequestedAt: null,
        dataCloudAccessTokenReceivedAt: null,

        dataCloudMetadataRequestedAt: null,
        dataCloudMetadataReceivedAt: null,

        channelSetupStartedAt: null,
        channelSetupCancelledAt: null,
        channelSetupFailedAt: null,
        channelReadyAt: null,
        healthCheckStartedAt: null,
        healthCheckCancelledAt: null,
        healthCheckFailedAt: null,
        healthCheckSucceededAt: null,
    };
}

export interface SalesforceConnectionStateDetails {
    /// The setup timings
    setupTimings: SalesforceSetupTimings;
    /// The setup params
    setupParams: SalesforceConnectionParams | null;
    /// The setup error
    setupError: DetailedError | null;

    /// The PKCE challenge
    pkceChallenge: PKCEChallenge | null;
    /// The popup window (if starting the OAuth flow from the browser)
    openAuthWindow: Window | null;
    /// The code
    coreAuthCode: string | null;
    /// The core access token
    coreAccessToken: SalesforceCoreAccessToken | null;
    /// The data cloud access token
    dataCloudAccessToken: SalesforceDataCloudAccessToken | null;

    /// The authentication error
    channelError: DetailedError | null;
    /// The Hyper connection
    channel: SalesforceDatabaseChannel | null;
    /// The health check error
    healthCheckError: DetailedError | null;
}

export function createSalesforceConnectionStateDetails(): SalesforceConnectionStateDetails {
    return {
        setupTimings: createSalesforceSetupTimings(),
        setupParams: null,
        setupError: null,

        pkceChallenge: null,
        openAuthWindow: null,
        coreAuthCode: null,
        coreAccessToken: null,
        dataCloudAccessToken: null,

        channelError: null,
        channel: null,
        healthCheckError: null,
    };
}

export function createSalesforceConnectionState(dql: dashql.DashQL): ConnectionStateWithoutId {
    return createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD], {
        type: SALESFORCE_DATA_CLOUD_CONNECTOR,
        value: createSalesforceConnectionStateDetails(),
    });
}

export function getSalesforceConnectionDetails(state: ConnectionState | null): SalesforceConnectionStateDetails | null {
    if (state == null) return null;
    switch (state.details.type) {
        case SALESFORCE_DATA_CLOUD_CONNECTOR: return state.details.value;
        default: return null;
    }
}

export const AUTH_CANCELLED = Symbol('AUTH_CANCELLED');
export const AUTH_FAILED = Symbol('AUTH_FAILED');
export const AUTH_STARTED = Symbol('AUTH_STARTED');

export const GENERATING_PKCE_CHALLENGE = Symbol('GENERATING_PKCE_CHALLENGE');
export const GENERATED_PKCE_CHALLENGE = Symbol('GENERATED_PKCE_CHALLENGE');
export const OAUTH_NATIVE_LINK_OPENED = Symbol('OAUTH_NATIVE_LINK_OPENED');
export const OAUTH_WEB_WINDOW_CLOSED = Symbol('OAUTH_WEB_WINDOW_CLOSED');
export const OAUTH_WEB_WINDOW_OPENED = Symbol('OAUTH_WEB_WINDOW_OPENED');
export const RECEIVED_CORE_AUTH_CODE = Symbol('RECEIVED_AUTH_CODE');
export const REQUESTING_CORE_AUTH_TOKEN = Symbol('REQUESTING_CORE_AUTH_TOKEN');
export const RECEIVED_CORE_AUTH_TOKEN = Symbol('RECEIVED_CORE_ACCESS_TOKEN');
export const REQUESTING_DATA_CLOUD_ACCESS_TOKEN = Symbol('REQUESTING_DATA_CLOUD_ACCESS_TOKEN');
export const RECEIVED_DATA_CLOUD_ACCESS_TOKEN = Symbol('RECEIVED_DATA_CLOUD_ACCESS_TOKEN');

export type SalesforceConnectionStateAction =
    | VariantKind<typeof AUTH_CANCELLED, DetailedError>
    | VariantKind<typeof AUTH_FAILED, DetailedError>
    | VariantKind<typeof AUTH_STARTED, SalesforceConnectionParams>
    | VariantKind<typeof CHANNEL_READY, SalesforceDatabaseChannel>
    | VariantKind<typeof CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof CHANNEL_SETUP_STARTED, HyperGrpcConnectionParams>
    | VariantKind<typeof GENERATED_PKCE_CHALLENGE, PKCEChallenge>
    | VariantKind<typeof GENERATING_PKCE_CHALLENGE, null>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, null>
    | VariantKind<typeof HEALTH_CHECK_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    | VariantKind<typeof OAUTH_NATIVE_LINK_OPENED, null>
    | VariantKind<typeof OAUTH_WEB_WINDOW_CLOSED, null>
    | VariantKind<typeof OAUTH_WEB_WINDOW_OPENED, Window>
    | VariantKind<typeof RECEIVED_CORE_AUTH_CODE, string>
    | VariantKind<typeof RECEIVED_CORE_AUTH_TOKEN, SalesforceCoreAccessToken>
    | VariantKind<typeof RECEIVED_DATA_CLOUD_ACCESS_TOKEN, SalesforceDataCloudAccessToken>
    | VariantKind<typeof REQUESTING_CORE_AUTH_TOKEN, null>
    | VariantKind<typeof REQUESTING_DATA_CLOUD_ACCESS_TOKEN, null>
    | VariantKind<typeof RESET, null>
    ;

export function reduceSalesforceConnectionState(state: ConnectionState, action: SalesforceConnectionStateAction): ConnectionState | null {
    const details = state.details.value as SalesforceConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case RESET:
            next = {
                ...state,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        setupTimings: createSalesforceSetupTimings(),
                        setupParams: details.setupParams,
                        setupError: null,

                        pkceChallenge: null,
                        openAuthWindow: null,
                        coreAuthCode: null,
                        coreAccessToken: null,
                        dataCloudAccessToken: null,

                        channelError: null,
                        channel: null,
                        healthCheckError: null,
                    }
                }
            };
            break;
        case AUTH_STARTED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.AUTH_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                metrics: state.metrics,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        setupTimings: {
                            ...createSalesforceSetupTimings(),
                            authStartedAt: new Date(),
                        },
                        setupParams: action.value,
                        setupError: null,

                        pkceChallenge: null,
                        openAuthWindow: null,
                        coreAuthCode: null,
                        coreAccessToken: null,
                        dataCloudAccessToken: null,

                        channelError: null,
                        channel: null,
                        healthCheckError: null,
                    }
                }
            };
            break
        case AUTH_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.AUTH_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            authCancelledAt: new Date(),
                        },
                        setupError: action.value
                    }
                }
            };
            break;
        case AUTH_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.AUTH_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            authFailedAt: new Date(),
                        },
                        setupError: action.value,
                    }
                }
            };
            break;
        case GENERATING_PKCE_CHALLENGE:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.PKCE_GENERATION_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            pkceGenStartedAt: new Date(),
                        },
                    }
                }
            };
            break;
        case GENERATED_PKCE_CHALLENGE:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.PKCE_GENERATED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            pkceGenFinishedAt: new Date(),
                        },
                        pkceChallenge: action.value,
                    }
                }
            };
            break;
        case OAUTH_NATIVE_LINK_OPENED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_LINK,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            openedNativeAuthLinkAt: new Date(),
                        },
                        openAuthWindow: null,
                    }
                }
            };
            break;
        case OAUTH_WEB_WINDOW_OPENED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_WINDOW,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            openedWebAuthWindowAt: new Date(),
                        },
                        openAuthWindow: action.value,
                    }
                }
            };
            break;
        case OAUTH_WEB_WINDOW_CLOSED:
            if (!details.openAuthWindow) return state;
            next = {
                ...state,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            closedWebAuthWindowAt: new Date(),
                        },
                        openAuthWindow: null,
                    }
                }
            };
            break;
        case RECEIVED_CORE_AUTH_CODE:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.OAUTH_CODE_RECEIVED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            oauthCodeReceivedAt: new Date(),
                        },
                        coreAuthCode: action.value,
                    }
                }
            };
            break;
        case REQUESTING_CORE_AUTH_TOKEN:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CORE_ACCESS_TOKEN_REQUESTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            coreAccessTokenRequestedAt: new Date(),
                        },
                    }
                }
            };
            break;
        case RECEIVED_CORE_AUTH_TOKEN:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CORE_ACCESS_TOKEN_RECEIVED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            coreAccessTokenReceivedAt: new Date(),
                        },
                        coreAccessToken: action.value,
                    }
                }
            };
            break;
        case REQUESTING_DATA_CLOUD_ACCESS_TOKEN:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.DATA_CLOUD_TOKEN_REQUESTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            dataCloudAccessTokenRequestedAt: new Date(),
                        },
                    }
                }
            };
            break;
        case RECEIVED_DATA_CLOUD_ACCESS_TOKEN:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.DATA_CLOUD_TOKEN_RECEIVED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            dataCloudAccessTokenReceivedAt: new Date(),
                        },
                        dataCloudAccessToken: action.value,
                    }
                }
            };
            break;
        case CHANNEL_SETUP_STARTED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            channelSetupStartedAt: new Date(),
                        },
                        channelError: null,
                        channel: null,
                        healthCheckError: null,
                    }
                },
            };
            break;
        case CHANNEL_SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            channelSetupCancelledAt: new Date(),
                        },
                        channelError: action.value,
                        channel: null
                    }
                },
            };
            break;
        case CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            channelSetupFailedAt: new Date(),
                        },
                        channelError: action.value,
                        channel: null
                    }
                },
            };
            break;
        case CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            channelReadyAt: new Date(),
                        },
                        channel: action.value
                    }
                },
            };
            break;
        case HEALTH_CHECK_STARTED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckStartedAt: new Date(),
                        },
                    }
                },
            };
            break;
        case HEALTH_CHECK_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckFailedAt: new Date(),
                        },
                        healthCheckError: action.value,
                    }
                },
            };
            break;
        case HEALTH_CHECK_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckCancelledAt: new Date(),
                        },
                    }
                },
            };
            break;
        case HEALTH_CHECK_SUCCEEDED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_SUCCEEDED,
                connectionHealth: ConnectionHealth.ONLINE,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckSucceededAt: new Date(),
                        },
                    }
                },
            };
            break;
    }
    return next;
}
