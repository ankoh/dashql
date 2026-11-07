import type * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { describe, expect, it } from 'vitest';

import { ConnectionHealth, ConnectionStatus, DELETE_CONNECTION, RESET_CONNECTION, type ConnectionState } from '../connection_state.js';
import { HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR } from '../connector_info.js';
import { connectorState, fakeChannel, reduceConnector, TEST_AUTH_CODE, TEST_ERROR, TEST_PKCE } from '../../tests/mocks/connector_state.js';
import type { SalesforceDatabaseChannel } from './salesforce_api_client.js';
import {
    createSalesforceConnectionStateDetails,
    GENERATED_PKCE_CHALLENGE,
    GENERATING_PKCE_CHALLENGE,
    getSalesforceConnectionDetails,
    OAUTH_NATIVE_LINK_OPENED,
    OAUTH_WEB_WINDOW_CLOSED,
    OAUTH_WEB_WINDOW_OPENED,
    RECEIVED_CORE_AUTH_CODE,
    RECEIVED_CORE_AUTH_TOKEN,
    RECEIVED_CORE_USER_INFO,
    RECEIVED_DATA_CLOUD_ACCESS_TOKEN,
    reduceSalesforceConnectionState,
    REQUESTING_CORE_AUTH_TOKEN,
    REQUESTING_DATA_CLOUD_ACCESS_TOKEN,
    SETUP_CANCELLED,
    SETUP_FAILED,
    SETUP_STARTED,
    SF_CHANNEL_READY,
    SF_CHANNEL_SETUP_CANCELLED,
    SF_CHANNEL_SETUP_FAILED,
    SF_CHANNEL_SETUP_STARTED,
    type SalesforceConnectionStateAction,
} from './salesforce_connection_state.js';

const PARAMS: connection.SalesforceConnectionParams = {
    instanceUrl: 'https://example.my.salesforce.com',
    appConsumerKey: 'consumer-key',
    appConsumerSecret: '',
    login: '',
};
const CORE_TOKEN = { accessToken: 'core', createdAt: '2026-01-01T00:00:00.000Z' } as connection.SalesforceCoreAccessToken;
const DATA_CLOUD_TOKEN = { createdAt: '2026-01-01T00:00:00.000Z' } as connection.SalesforceDataCloudAccessToken;

const initial = (type: symbol = SALESFORCE_DATA_CLOUD_CONNECTOR) => connectorState(type, createSalesforceConnectionStateDetails(PARAMS));
const reduce = (state: ConnectionState, action: SalesforceConnectionStateAction) => reduceConnector(reduceSalesforceConnectionState, state, action);
const proto = (state: ConnectionState) => getSalesforceConnectionDetails(state)!.proto;
const userInfo = (info: Partial<connection.SalesforceCoreUserInfo>) =>
    ({ type: RECEIVED_CORE_USER_INFO, value: info as connection.SalesforceCoreUserInfo }) as const;

describe('reduceSalesforceConnectionState', () => {
    it.each([
        [SETUP_STARTED, PARAMS, ConnectionStatus.AUTH_STARTED, ConnectionHealth.CONNECTING, 'authStartedAt'],
        [SETUP_CANCELLED, TEST_ERROR, ConnectionStatus.AUTH_CANCELLED, ConnectionHealth.CANCELLED, 'authCancelledAt'],
        [SETUP_FAILED, TEST_ERROR, ConnectionStatus.AUTH_FAILED, ConnectionHealth.FAILED, 'authFailedAt'],
        [GENERATING_PKCE_CHALLENGE, null, ConnectionStatus.PKCE_GENERATION_STARTED, ConnectionHealth.CONNECTING, 'pkceGenStartedAt'],
        [GENERATED_PKCE_CHALLENGE, TEST_PKCE, ConnectionStatus.PKCE_GENERATED, ConnectionHealth.CONNECTING, 'pkceGenFinishedAt'],
        [OAUTH_NATIVE_LINK_OPENED, null, ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_LINK, ConnectionHealth.CONNECTING, 'openedNativeAuthLinkAt'],
        [OAUTH_WEB_WINDOW_OPENED, null, ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_WINDOW, ConnectionHealth.CONNECTING, 'openedWebAuthWindowAt'],
        [OAUTH_WEB_WINDOW_CLOSED, null, ConnectionStatus.NOT_STARTED, ConnectionHealth.NOT_STARTED, 'closedWebAuthWindowAt'],
        [RECEIVED_CORE_AUTH_CODE, TEST_AUTH_CODE, ConnectionStatus.OAUTH_CODE_RECEIVED, ConnectionHealth.CONNECTING, 'oauthCodeReceivedAt'],
        [REQUESTING_CORE_AUTH_TOKEN, null, ConnectionStatus.ACCESS_TOKEN_REQUESTED, ConnectionHealth.CONNECTING, 'coreAccessTokenRequestedAt'],
        [RECEIVED_CORE_AUTH_TOKEN, CORE_TOKEN, ConnectionStatus.CORE_ACCESS_TOKEN_RECEIVED, ConnectionHealth.CONNECTING, 'coreAccessTokenReceivedAt'],
        [REQUESTING_DATA_CLOUD_ACCESS_TOKEN, null, ConnectionStatus.DATA_CLOUD_TOKEN_REQUESTED, ConnectionHealth.CONNECTING, 'dataCloudAccessTokenRequestedAt'],
        [RECEIVED_DATA_CLOUD_ACCESS_TOKEN, DATA_CLOUD_TOKEN, ConnectionStatus.DATA_CLOUD_TOKEN_RECEIVED, ConnectionHealth.CONNECTING, 'dataCloudAccessTokenReceivedAt'],
        [SF_CHANNEL_SETUP_STARTED, {}, ConnectionStatus.CHANNEL_SETUP_STARTED, ConnectionHealth.CONNECTING, 'channelSetupStartedAt'],
        [SF_CHANNEL_SETUP_CANCELLED, TEST_ERROR, ConnectionStatus.CHANNEL_SETUP_CANCELLED, ConnectionHealth.CANCELLED, 'channelSetupCancelledAt'],
        [SF_CHANNEL_SETUP_FAILED, TEST_ERROR, ConnectionStatus.CHANNEL_SETUP_FAILED, ConnectionHealth.FAILED, 'channelSetupFailedAt'],
    ] as const)('%s sets the status, health and timing', (type, value, status, health, timing) => {
        const next = reduce(initial(), { type, value } as SalesforceConnectionStateAction);
        expect(next.connectionStatus).toEqual(status);
        expect(next.connectionHealth).toEqual(health);
        expect(proto(next).setupTimings[timing]).toBeDefined();
    });

    it('collects the OAuth state of the steps', () => {
        let state = reduce(initial(), { type: SETUP_STARTED, value: PARAMS });
        const oauthParams = proto(state).oauthState!.oauthParams;
        expect(oauthParams.instanceUrl).toEqual(PARAMS.instanceUrl);
        expect(oauthParams.expiresAt - oauthParams.requestedAt).toEqual(2 * 60 * 60 * 1000);

        state = reduce(state, { type: GENERATED_PKCE_CHALLENGE, value: TEST_PKCE });
        state = reduce(state, { type: RECEIVED_CORE_AUTH_CODE, value: TEST_AUTH_CODE });
        state = reduce(state, { type: RECEIVED_CORE_AUTH_TOKEN, value: CORE_TOKEN });
        state = reduce(state, { type: RECEIVED_DATA_CLOUD_ACCESS_TOKEN, value: DATA_CLOUD_TOKEN });
        expect(proto(state).oauthState).toEqual({
            oauthParams,
            oauthPkce: TEST_PKCE,
            coreAuthCode: TEST_AUTH_CODE,
            coreAccessToken: CORE_TOKEN,
            dataCloudAccessToken: DATA_CLOUD_TOKEN,
        });
    });

    it('stores the login of the user info, the username before the email', () => {
        const byUsername = reduce(initial(), userInfo({ preferredUsername: 'user@example.com', email: 'mail@example.com' }));
        expect(proto(byUsername).setupParams?.login).toEqual('user@example.com');
        const byEmail = reduce(initial(), userInfo({ email: 'mail@example.com' }));
        expect(proto(byEmail).setupParams?.login).toEqual('mail@example.com');
        expect(proto(reduce(byEmail, userInfo({}))).setupParams?.login).toEqual('mail@example.com');
    });

    it('keeps the details type of Database.com connections', () => {
        expect(reduce(initial(DBCOM_CONNECTOR), { type: SETUP_STARTED, value: PARAMS }).details.type).toBe(DBCOM_CONNECTOR);
    });

    it.each([RESET_CONNECTION, DELETE_CONNECTION] as const)('%s closes the channel and clears the setup', type => {
        const channel = fakeChannel<SalesforceDatabaseChannel>();
        const failed = reduce(initial(), { type: SETUP_FAILED, value: TEST_ERROR });
        const ready = reduce(failed, { type: SF_CHANNEL_READY, value: channel });
        expect(getSalesforceConnectionDetails(ready)!.channel).toBe(channel);

        const reset = reduce(ready, { type, value: null });
        expect(channel.close).toHaveBeenCalledTimes(1);
        expect(getSalesforceConnectionDetails(reset)!.channel).toBeNull();
        expect(proto(reset).setupTimings).toEqual({});
        expect(proto(reset).setupError).toBeUndefined();
    });

    it('returns null for unknown actions and other connectors', () => {
        expect(reduceSalesforceConnectionState(initial(), { type: Symbol('OTHER'), value: null } as unknown as SalesforceConnectionStateAction)).toBeNull();
        expect(getSalesforceConnectionDetails(connectorState(HYPER_CONNECTOR, {}))).toBeNull();
        expect(getSalesforceConnectionDetails(null)).toBeNull();
    });
});
