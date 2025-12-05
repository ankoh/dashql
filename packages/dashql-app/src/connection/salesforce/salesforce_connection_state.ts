import * as dashql from '@ankoh/dashql-core';
import * as buf from "@bufbuild/protobuf";
import * as pb from '@ankoh/dashql-protobuf';

import { VariantKind } from '../../utils/variant.js';
import { SalesforceDatabaseChannel } from './salesforce_api_client.js';
import { CONNECTOR_INFOS, ConnectorType, SALESFORCE_DATA_CLOUD_CONNECTOR } from '../connector_info.js';
import {
    ConnectionHealth,
    ConnectionState,
    ConnectionStateWithoutId,
    ConnectionStatus,
    createConnectionState,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_SUCCEEDED,
    RESET,
} from '../connection_state.js';
import { Hasher } from '../../utils/hash.js';
import { ConnectionSignatureMap, updateConnectionSignature } from '../../connection/connection_signature.js';
import { DefaultHasher } from '../../utils/hash_default.js';
import { dateToTimestamp } from "../../connection/proto_helper.js";
import { StorageWriter } from 'platform/storage_writer.js';

/// The Salesforce connection state
export interface SalesforceConnectionStateDetails {
    /// The proto
    proto: pb.dashql.connection.SalesforceConnectionDetails;
    /// The open auth window
    openAuthWindow: Window | null,
    /// The Hyper connection
    channel: SalesforceDatabaseChannel | null;
}

/// Create the connection state details
export function createSalesforceConnectionStateDetails(params?: pb.dashql.connection.SalesforceConnectionParams): SalesforceConnectionStateDetails {
    return {
        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema),
            setupParams: params
        }),
        openAuthWindow: null,
        channel: null
    };
}

/// Create the connection state
export function createSalesforceConnectionState(dql: dashql.DashQL, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    return createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD], connSigs, {
        type: SALESFORCE_DATA_CLOUD_CONNECTOR,
        value: createSalesforceConnectionStateDetails(),
    });
}

/// Unpack the connection state from the variant
export function getSalesforceConnectionDetails(state: ConnectionState | null): SalesforceConnectionStateDetails | null {
    if (state == null) return null;
    switch (state.details.type) {
        case SALESFORCE_DATA_CLOUD_CONNECTOR: return state.details.value;
        default: return null;
    }
}

export function computeSalesforceConnectionSignature(details: SalesforceConnectionStateDetails, hasher: Hasher) {
    hasher.add("salesforce");
    hasher.add(details.proto.setupParams?.instanceUrl ?? "");
    hasher.add(details.proto.setupParams?.appConsumerKey ?? "");
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
export const REQUESTING_DATA_CLOUD_ACCESS_TOKEN = Symbol('REQUESTING_DATA_CLOUD_ACCESS_TOKEN');
export const RECEIVED_DATA_CLOUD_ACCESS_TOKEN = Symbol('RECEIVED_DATA_CLOUD_ACCESS_TOKEN');

export type SalesforceConnectionStateAction =
    | VariantKind<typeof SETUP_CANCELLED, pb.dashql.error.DetailedError>
    | VariantKind<typeof SETUP_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof SETUP_STARTED, pb.dashql.connection.SalesforceConnectionParams>
    | VariantKind<typeof GENERATED_PKCE_CHALLENGE, pb.dashql.auth.OAuthPKCEChallenge>
    | VariantKind<typeof GENERATING_PKCE_CHALLENGE, null>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, null>
    | VariantKind<typeof HEALTH_CHECK_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    | VariantKind<typeof OAUTH_NATIVE_LINK_OPENED, null>
    | VariantKind<typeof OAUTH_WEB_WINDOW_CLOSED, null>
    | VariantKind<typeof OAUTH_WEB_WINDOW_OPENED, Window>
    | VariantKind<typeof RECEIVED_CORE_AUTH_CODE, pb.dashql.auth.TemporaryToken>
    | VariantKind<typeof RECEIVED_CORE_AUTH_TOKEN, pb.dashql.connection.SalesforceCoreAccessToken>
    | VariantKind<typeof RECEIVED_DATA_CLOUD_ACCESS_TOKEN, pb.dashql.connection.SalesforceDataCloudAccessToken>
    | VariantKind<typeof REQUESTING_CORE_AUTH_TOKEN, null>
    | VariantKind<typeof REQUESTING_DATA_CLOUD_ACCESS_TOKEN, null>
    | VariantKind<typeof SF_CHANNEL_READY, SalesforceDatabaseChannel>
    | VariantKind<typeof SF_CHANNEL_SETUP_CANCELLED, pb.dashql.error.DetailedError>
    | VariantKind<typeof SF_CHANNEL_SETUP_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof SF_CHANNEL_SETUP_STARTED, pb.dashql.connection.HyperConnectionParams>
    | VariantKind<typeof RESET, null>
    ;

export function reduceSalesforceConnectionState(state: ConnectionState, action: SalesforceConnectionStateAction, _storage: StorageWriter): ConnectionState | null {
    const details = state.details.value as SalesforceConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case RESET:
            next = {
                ...state,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema),
                            setupParams: details.proto.setupParams,
                            setupError: undefined,
                            channelError: undefined,
                            healthCheckError: undefined,
                        }),
                        channel: null,
                    }
                },
            };
            break;
        case SETUP_STARTED: {
            const newDetails: SalesforceConnectionStateDetails = {
                proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                    ...details.proto,
                    setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                        ...details.proto.setupTimings,
                        authStartedAt: dateToTimestamp(new Date()),
                    }),
                    setupParams: details.proto.setupParams,
                    setupError: undefined,
                    channelError: undefined,
                    healthCheckError: undefined,
                }),
                channel: null,
                openAuthWindow: null,
            };
            let sig = new DefaultHasher();
            computeSalesforceConnectionSignature(details, sig);
            next = {
                ...state,
                connectionStatus: ConnectionStatus.AUTH_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                metrics: state.metrics,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: newDetails,
                },
                connectionSignature: updateConnectionSignature(state.connectionSignature, sig, state.connectionId),
            };
            break
        }
        case SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.AUTH_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,

                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                authCancelledAt: dateToTimestamp(new Date()),
                            }),
                            setupError: action.value
                        }),
                        channel: null,
                    }
                }
            };
            break;
        case SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.AUTH_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                authFailedAt: dateToTimestamp(new Date()),
                            }),
                            setupError: action.value
                        }),
                        channel: null,
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                pkceGenStartedAt: dateToTimestamp(new Date()),
                            }),
                        }),
                        channel: null,
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                pkceGenFinishedAt: dateToTimestamp(new Date()),
                            }),
                            oauthState: buf.create(pb.dashql.connection.SalesforceOAuthStateSchema, {
                                oauthPkce: action.value,
                            })
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                openedNativeAuthLinkAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                openedWebAuthWindowAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                closedWebAuthWindowAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                oauthCodeReceivedAt: dateToTimestamp(new Date()),
                            }),
                            oauthState: buf.create(pb.dashql.connection.SalesforceOAuthStateSchema, {
                                ...details.proto.oauthState,
                                coreAuthCode: action.value,
                            })
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                coreAccessTokenRequestedAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                coreAccessTokenReceivedAt: dateToTimestamp(new Date()),
                            }),
                            oauthState: buf.create(pb.dashql.connection.SalesforceOAuthStateSchema, {
                                ...details.proto.oauthState,
                                coreAccessToken: action.value,
                            })
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                dataCloudAccessTokenRequestedAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                dataCloudAccessTokenReceivedAt: dateToTimestamp(new Date()),
                            }),
                            oauthState: buf.create(pb.dashql.connection.SalesforceOAuthStateSchema, {
                                ...details.proto.oauthState,
                                dataCloudAccessToken: action.value,
                            })
                        }),
                    }
                }
            };
            break;
        case SF_CHANNEL_SETUP_STARTED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelSetupStartedAt: dateToTimestamp(new Date()),
                            }),
                        }),
                        channel: null,
                    }
                },
            };
            break;
        case SF_CHANNEL_SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelSetupCancelledAt: dateToTimestamp(new Date()),
                            }),
                            channelError: action.value
                        }),
                        channel: null
                    }
                },
            };
            break;
        case SF_CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelSetupFailedAt: dateToTimestamp(new Date()),
                            }),
                            channelError: action.value
                        }),
                        channel: null
                    }
                },
            };
            break;
        case SF_CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelReadyAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckStartedAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckFailedAt: dateToTimestamp(new Date()),
                            }),
                            healthCheckError: action.value,
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckCancelledAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                        proto: buf.create(pb.dashql.connection.SalesforceConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SalesforceSetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckSucceededAt: dateToTimestamp(new Date()),
                            }),
                        }),
                    }
                },
            };
            break;
    }
    return next;
}
