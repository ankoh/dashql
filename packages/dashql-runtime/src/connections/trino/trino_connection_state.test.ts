import type * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import { ConnectionHealth, ConnectionStatus, DELETE_CONNECTION, RESET_CONNECTION, type ConnectionState } from '../connection_state.js';
import { ConnectorType } from '../connector_info.js';
import { connectorState, fakeChannel, reduceConnector, testCoreRuntime, TEST_AUTH_CODE, TEST_ERROR, TEST_PKCE } from '../../testing/mocks/connector_state.js';
import type { CoreRuntime } from '../../core_runtime.js';
import type { TrinoChannelInterface } from './trino_channel.js';
import {
    GENERATED_PKCE_CHALLENGE,
    GENERATING_PKCE_CHALLENGE,
    getTrinoConnectionDetails,
    OAUTH_BROWSER_OPENED,
    OAUTH_CANCELLED,
    OAUTH_FAILED,
    OAUTH_STARTED,
    RECEIVED_ACCESS_TOKEN,
    RECEIVED_OAUTH_CODE,
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

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
let runtime: CoreRuntime;
beforeAll(async () => { dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
beforeEach(() => { runtime = testCoreRuntime(dql); });
afterEach(() => runtime.destroy());

const initial = (connectionId = 'test') => connectorState(runtime, ConnectorType.TRINO, PARAMS, connectionId);
const reduce = (state: ConnectionState, action: TrinoConnectorAction) => reduceConnector(runtime, state, action)!;
const details = (state: ConnectionState) => getTrinoConnectionDetails(state)!;
const trino = (state: ConnectionState) => {
    const connector = details(state).connector;
    if (connector.kind !== 'trino') throw new Error('no Trino connection');
    return connector;
};

// The runtime applies the actions, `packages/dashql-core-runtime/src/connections/trino.rs`, after `runtimeActionOf`
// mapped them
describe('the setup of Trino connections', () => {
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
        expect(details(next).setupTimings[timing]).toBeDefined();
    });

    it('collects the OAuth state of the steps', () => {
        let state = reduce(initial(), { type: OAUTH_STARTED, value: PARAMS });
        state = reduce(state, { type: GENERATED_PKCE_CHALLENGE, value: TEST_PKCE });
        state = reduce(state, { type: RECEIVED_OAUTH_CODE, value: TEST_AUTH_CODE });
        state = reduce(state, { type: RECEIVED_ACCESS_TOKEN, value: ACCESS_TOKEN });
        // The token is opaque JSON
        expect(trino(state).oauthState).toEqual({ oauthPkce: TEST_PKCE, authCode: TEST_AUTH_CODE, accessToken: JSON.stringify(ACCESS_TOKEN) });
    });

    it('stores the channel error and clears it on the next channel setup', () => {
        const failed = reduce(initial(), { type: TRINO_CHANNEL_SETUP_FAILED, value: TEST_ERROR });
        expect(details(failed).channelError).toEqual(TEST_ERROR);
        expect(details(reduce(failed, { type: TRINO_CHANNEL_SETUP_STARTED, value: PARAMS })).channelError).toBeNull();
    });

    it.each([RESET_CONNECTION, DELETE_CONNECTION] as const)('%s closes the channel and clears the setup', type => {
        const channel = fakeChannel<TrinoChannelInterface>();
        const ready = reduce(reduce(initial(), { type: OAUTH_STARTED, value: PARAMS }), { type: TRINO_CHANNEL_READY, value: channel });
        expect(runtime.channel(ready)).toBe(channel);

        const reset = reduceConnector(runtime, ready, { type, value: null });
        expect(channel.close).toHaveBeenCalledTimes(1);
        if (type === DELETE_CONNECTION) {
            expect(reset).toBeNull();
            return;
        }
        expect(details(reset!)).toEqual({ ...details(initial('fresh')), setupTimings: {} });
    });

    it('refuses unknown actions and the actions of other connectors', () => {
        expect(() => reduce(initial(), { type: Symbol('OTHER'), value: null } as unknown as TrinoConnectorAction)).toThrow();
        const hyper = connectorState(runtime, ConnectorType.HYPER, {}, 'hyper');
        expect(() => reduce(hyper, { type: OAUTH_BROWSER_OPENED, value: null })).toThrow();
        expect(getTrinoConnectionDetails(hyper)).toBeNull();
        expect(getTrinoConnectionDetails(null)).toBeNull();
    });
});
