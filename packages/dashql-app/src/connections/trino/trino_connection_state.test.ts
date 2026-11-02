import type * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { describe, expect, it } from 'vitest';

import { ConnectionHealth, ConnectionStatus, DELETE_CONNECTION, RESET_CONNECTION, type ConnectionState } from '../connection_state.js';
import { HYPER_CONNECTOR, TRINO_CONNECTOR } from '../connector_info.js';
import { connectorState, fakeChannel, reduceConnector, TEST_AUTH_CODE, TEST_ERROR, TEST_PKCE } from '../../tests/mocks/connector_state.js';
import type { TrinoChannelInterface } from './trino_channel.js';
import {
    createTrinoConnectionStateDetails,
    GENERATED_PKCE_CHALLENGE,
    GENERATING_PKCE_CHALLENGE,
    getTrinoConnectionDetails,
    OAUTH_BROWSER_OPENED,
    OAUTH_CANCELLED,
    OAUTH_FAILED,
    OAUTH_STARTED,
    RECEIVED_ACCESS_TOKEN,
    RECEIVED_OAUTH_CODE,
    reduceTrinoConnectorState,
    REQUESTING_ACCESS_TOKEN,
    TRINO_CHANNEL_READY,
    TRINO_CHANNEL_SETUP_CANCELLED,
    TRINO_CHANNEL_SETUP_FAILED,
    TRINO_CHANNEL_SETUP_STARTED,
    type TrinoConnectorAction,
} from './trino_connection_state.js';

const PARAMS: connection.TrinoConnectionParams = {
    endpoint: 'https://trino.example.com',
    auth: { authType: 'AUTH_OAUTH' },
    catalogName: 'hive',
};
const ACCESS_TOKEN = { accessToken: 'token' } as unknown as connection.TrinoAccessToken;

const initial = () => connectorState(TRINO_CONNECTOR, createTrinoConnectionStateDetails(PARAMS));
const reduce = (state: ConnectionState, action: TrinoConnectorAction) => reduceConnector(reduceTrinoConnectorState, state, action);
const proto = (state: ConnectionState) => getTrinoConnectionDetails(state)!.proto;

describe('reduceTrinoConnectorState', () => {
    it.each([
        [OAUTH_STARTED, PARAMS, ConnectionStatus.AUTH_STARTED, ConnectionHealth.CONNECTING, 'oauthStartedAt'],
        [OAUTH_CANCELLED, TEST_ERROR, ConnectionStatus.AUTH_CANCELLED, ConnectionHealth.CANCELLED, 'oauthCancelledAt'],
        [OAUTH_FAILED, TEST_ERROR, ConnectionStatus.AUTH_FAILED, ConnectionHealth.FAILED, 'oauthFailedAt'],
        [GENERATING_PKCE_CHALLENGE, null, ConnectionStatus.PKCE_GENERATION_STARTED, ConnectionHealth.CONNECTING, 'pkceGenStartedAt'],
        [GENERATED_PKCE_CHALLENGE, TEST_PKCE, ConnectionStatus.PKCE_GENERATED, ConnectionHealth.CONNECTING, 'pkceGenFinishedAt'],
        [OAUTH_BROWSER_OPENED, null, ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_LINK, ConnectionHealth.CONNECTING, 'oauthBrowserOpenedAt'],
        [RECEIVED_OAUTH_CODE, TEST_AUTH_CODE, ConnectionStatus.OAUTH_CODE_RECEIVED, ConnectionHealth.CONNECTING, 'oauthCodeReceivedAt'],
        [REQUESTING_ACCESS_TOKEN, null, ConnectionStatus.ACCESS_TOKEN_REQUESTED, ConnectionHealth.CONNECTING, 'accessTokenRequestedAt'],
        [RECEIVED_ACCESS_TOKEN, ACCESS_TOKEN, ConnectionStatus.ACCESS_TOKEN_RECEIVED, ConnectionHealth.CONNECTING, 'accessTokenReceivedAt'],
        [TRINO_CHANNEL_SETUP_STARTED, PARAMS, ConnectionStatus.CHANNEL_SETUP_STARTED, ConnectionHealth.CONNECTING, 'channelSetupStartedAt'],
        [TRINO_CHANNEL_SETUP_CANCELLED, TEST_ERROR, ConnectionStatus.CHANNEL_SETUP_CANCELLED, ConnectionHealth.CANCELLED, 'channelSetupCancelledAt'],
        [TRINO_CHANNEL_SETUP_FAILED, TEST_ERROR, ConnectionStatus.CHANNEL_SETUP_FAILED, ConnectionHealth.FAILED, 'channelSetupFailedAt'],
    ] as const)('%s sets the status, health and timing', (type, value, status, health, timing) => {
        const next = reduce(initial(), { type, value } as TrinoConnectorAction);
        expect(next.connectionStatus).toEqual(status);
        expect(next.connectionHealth).toEqual(health);
        expect(proto(next).setupTimings[timing]).toBeDefined();
    });

    it('collects the OAuth state of the steps', () => {
        let state = reduce(initial(), { type: OAUTH_STARTED, value: PARAMS });
        state = reduce(state, { type: GENERATED_PKCE_CHALLENGE, value: TEST_PKCE });
        state = reduce(state, { type: RECEIVED_OAUTH_CODE, value: TEST_AUTH_CODE });
        state = reduce(state, { type: RECEIVED_ACCESS_TOKEN, value: ACCESS_TOKEN });
        expect(proto(state).oauthState).toEqual({ oauthPkce: TEST_PKCE, authCode: TEST_AUTH_CODE, accessToken: ACCESS_TOKEN });
    });

    it('stores the channel error and clears it on the next channel setup', () => {
        const failed = reduce(initial(), { type: TRINO_CHANNEL_SETUP_FAILED, value: TEST_ERROR });
        expect(proto(failed).channelError).toEqual(TEST_ERROR);
        expect(proto(reduce(failed, { type: TRINO_CHANNEL_SETUP_STARTED, value: PARAMS })).channelError).toBeUndefined();
    });

    it.each([RESET_CONNECTION, DELETE_CONNECTION] as const)('%s closes the channel and clears the setup', type => {
        const channel = fakeChannel<TrinoChannelInterface>();
        const ready = reduce(reduce(initial(), { type: OAUTH_STARTED, value: PARAMS }), { type: TRINO_CHANNEL_READY, value: channel });
        expect(getTrinoConnectionDetails(ready)!.channel).toBe(channel);

        const reset = reduce(ready, { type, value: null });
        expect(channel.close).toHaveBeenCalledTimes(1);
        expect(getTrinoConnectionDetails(reset)!.channel).toBeNull();
        expect(proto(reset)).toEqual({ ...proto(initial()), setupTimings: {} });
    });

    it('returns null for unknown actions and other connectors', () => {
        expect(reduceTrinoConnectorState(initial(), { type: Symbol('OTHER'), value: null } as unknown as TrinoConnectorAction)).toBeNull();
        expect(getTrinoConnectionDetails(connectorState(HYPER_CONNECTOR, {}))).toBeNull();
        expect(getTrinoConnectionDetails(null)).toBeNull();
    });
});
