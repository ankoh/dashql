import * as connection from '@akohn/dashql-jsonschema/connection.js';
import * as core from '@akohn/dashql';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OAuthState } from '@akohn/dashql/platform/oauth_types';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { PlatformType } from '../../host/platform_type.js';
import { AppOAuthFlow } from '../../oauth/app_oauth_flow.js';
import type { PlatformEventListener } from '../../host/events/event_listener.js';
import { BASE64URL_CODEC } from '@akohn/dashql/platform/utils/base64';
import type { HttpClient } from '@akohn/dashql/platform/http_client';
import { createRuntime } from '@akohn/dashql/runtime/runtime';
import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { TASK_UPDATE_SCHEDULER } from '@akohn/dashql/runtime/store/update_scheduler';
import type { OAuthFlow } from '@akohn/dashql/platform/oauth_flow';
import { DATA_CLOUD_JWT, fakeSalesforceHttp } from './salesforce_test_http.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// A step of a login, its name: the listener hears no code and no token
type SalesforceAuthenticationProgress = { stage: string };

interface LoginOptions {
    logger: Logger;
    params: connection.SalesforceConnectionParams;
    authConfig: connection.SalesforceOAuthConfig;
    oauthFlow: OAuthFlow;
    /// The HTTP client of the requests, none for a login that sends none
    http: HttpClient | null;
    forceReLogin: boolean;
    abortSignal: AbortSignal;
    onProgress?: (progress: SalesforceAuthenticationProgress) => void;
}

/// The login of the runtime with the HTTP client: the tokens and the user, a failure throws
async function authenticateSalesforce(options: LoginOptions) {
    const runtime = createRuntime({ logger: options.logger, scheduler: TASK_UPDATE_SCHEDULER, core: dql, http: options.http, oauthFlow: options.oauthFlow });
    const cancel = () => runtime.module.cancelSetup('login');
    options.abortSignal.addEventListener('abort', cancel, { once: true });
    try {
        const outcome = await runtime.authenticateSalesforce('login', options.params, { oauthRedirect: options.authConfig.oauthRedirect, forceRelogin: options.forceReLogin }, {
            onStep: step => {
                // The steps are names, the start and the end of the login are in its outcome
                expect(typeof step).toBe('string');
                if (!step.startsWith('SETUP_')) options.onProgress?.({ stage: step });
            },
        });
        if (options.abortSignal.aborted) throw options.abortSignal.reason;
        if (outcome.status === 'cancelled') throw new DOMException(outcome.message ?? 'cancelled', 'AbortError');
        if (outcome.authentication == null) throw new Error(outcome.message ?? 'the login failed');
        const { tokens, userInfo } = outcome.authentication;
        return {
            coreAccessToken: tokens.core as connection.SalesforceCoreAccessToken,
            dataCloudAccessToken: tokens.dataCloud as connection.SalesforceDataCloudAccessToken,
            coreUserInfo: (userInfo ?? undefined) as connection.SalesforceCoreUserInfo | undefined,
        };
    } finally {
        options.abortSignal.removeEventListener('abort', cancel);
        runtime.destroy();
    }
}

const params: connection.SalesforceConnectionParams = {
    instanceUrl: 'https://example.my.salesforce.com',
    appConsumerKey: 'consumer+key',
    appConsumerSecret: '',
    login: 'test+oauth@example.com',
};
const authConfig: connection.SalesforceOAuthConfig = {
    oauthRedirect: 'https://dashql.app/oauth.html',
};


function decodeState(url: URL): OAuthState {
    const encoded = url.searchParams.get('state')!;
    return JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(encoded)));
}

/// The redirect of the app hands back the callback with the state of the authorization URL
/// App events that answer the wait for the OAuth redirect, the only call of the flow
function redirectWith(open: { mock: { calls: unknown[][] } }, callback: (state: OAuthState) => object = state => ({ state, code: 'authorization-code' })): PlatformEventListener {
    const events = {
        waitForOAuthRedirect: vi.fn().mockImplementation(async () => callback(decodeState(new URL(String(open.mock.calls[0][0]))))),
    };
    return events as unknown as PlatformEventListener;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// The login runs in the Rust runtime and sends its requests with the HTTP client of the platform. The URL and the
// check of the callback state are tested with the setup of the crate as well (`tests/salesforce_test.rs`).
describe('authenticateSalesforce', () => {
    it('carries the flavor of the document in the OAuth state', async () => {
        document.documentElement.dataset.flavor = 'dbcom';
        try {
            const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
            const open = vi.spyOn(window, 'open').mockReturnValue(popup);
            await authenticateSalesforce({
                logger: new TestLogger(),
                params,
                authConfig,
                oauthFlow: new AppOAuthFlow(redirectWith(open), PlatformType.WEB),
                http: fakeSalesforceHttp(),
                forceReLogin: false,
                abortSignal: new AbortController().signal,
            });
            expect(decodeState(new URL(open.mock.calls[0][0]!.toString())).flavor).toBe('dbcom');
        } finally {
            delete document.documentElement.dataset.flavor;
        }
    });

    it('encodes the parameters of the authorization URL with the PKCE S256 parameter', async () => {
        const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockReturnValue(popup);
        await authenticateSalesforce({
            logger: new TestLogger(), params, authConfig, oauthFlow: new AppOAuthFlow(redirectWith(open), PlatformType.WEB),
            http: fakeSalesforceHttp(), forceReLogin: true, abortSignal: new AbortController().signal,
        });
        const url = new URL(open.mock.calls[0][0]!.toString());
        expect(url.origin + url.pathname).toBe('https://example.my.salesforce.com/services/oauth2/authorize');
        expect(url.searchParams.get('client_id')).toBe('consumer+key');
        expect(url.searchParams.get('login_hint')).toBe('test+oauth@example.com');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.has('code_challange_method')).toBe(false);
        expect(url.searchParams.get('prompt')).toBe('login');
        expect(decodeState(url).salesforceProvider?.appConsumerKey).toBe('consumer+key');
    });

    it('returns both tokens and optional user info through staged progress', async () => {
        const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockReturnValue(popup);
        const logger = new TestLogger();
        const info = vi.spyOn(logger, 'info');
        const http = fakeSalesforceHttp({ userInfo: { preferred_username: 'user@example.com', organization_id: 'org-1' } });
        const stages: string[] = [];

        const result = await authenticateSalesforce({
            logger,
            params,
            authConfig,
            oauthFlow: new AppOAuthFlow(redirectWith(open), PlatformType.WEB),
            http,
            forceReLogin: false,
            abortSignal: new AbortController().signal,
            onProgress: progress => stages.push(progress.stage),
        });

        expect(result.coreAccessToken.accessToken).toBe('core-token');
        expect(result.dataCloudAccessToken.jwt.raw).toBe(DATA_CLOUD_JWT);
        expect(result.coreUserInfo?.preferredUsername).toBe('user@example.com');
        expect(result.coreUserInfo?.organizationId).toBe('org-1');
        // The Data 360 token is exchanged for the core token
        expect(http.paths).toEqual(expect.arrayContaining(['/services/oauth2/token', '/services/oauth2/userinfo', '/services/a360/token']));
        expect(http.paths.indexOf('/services/oauth2/token')).toBeLessThan(http.paths.indexOf('/services/a360/token'));
        // The setup logs the authorization URL on the target of the Salesforce setup
        const opening = info.mock.calls.find(call => call[1]?.endpoint === 'https://example.my.salesforce.com/services/oauth2/authorize')!;
        expect(opening[1]).toMatchObject({
            flowVariant: 'WEB_OPENER_FLOW',
            authorizationParameters: expect.stringContaining('"client_id":"consumer+key"'),
            oauthState: expect.stringContaining('"flowId":"<redacted>"'),
        });
        expect(opening[2]).toBe('salesforce_setup');
        const authorizationParameters = JSON.parse(opening[1].authorizationParameters as string);
        expect(authorizationParameters.redirect_uri).toBe('https://dashql.app/oauth.html');
        expect(authorizationParameters.code_challenge_method).toBe('S256');
        expect(authorizationParameters.response_type).toBe('code');
        expect(authorizationParameters.state).toBe('<redacted>');
        expect(authorizationParameters.code_challenge).toBe('<redacted>');
        expect(JSON.stringify(info.mock.calls)).not.toContain('test+oauth@example.com');
        expect(popup.close).toHaveBeenCalledOnce();
        // The stages of the web flow, from the challenge to the Data 360 token
        expect(stages[0]).toBe('GENERATING_PKCE_CHALLENGE');
        expect(stages).toEqual(expect.arrayContaining(['OAUTH_WEB_WINDOW_OPENED', 'OAUTH_WEB_WINDOW_CLOSED']));
        expect(stages[stages.length - 1]).toBe('RECEIVED_DATA_CLOUD_ACCESS_TOKEN');
    });

    it('opens native OAuth in the system browser and waits for a deep-link callback', async () => {
        const openExternal = vi.fn();
        vi.stubGlobal('dashqlElectron', { openExternal });
        const open = vi.spyOn(window, 'open');
        const stages: string[] = [];

        const result = await authenticateSalesforce({
            logger: new TestLogger(),
            params,
            authConfig,
            oauthFlow: new AppOAuthFlow(redirectWith(openExternal), PlatformType.DESKTOP),
            http: fakeSalesforceHttp({ userInfo: null }),
            forceReLogin: false,
            abortSignal: new AbortController().signal,
            onProgress: progress => stages.push(progress.stage),
        });
        // The user info is optional
        expect(result.coreAccessToken.accessToken).toBe('core-token');
        expect(result.coreUserInfo).toBeUndefined();

        expect(open).not.toHaveBeenCalled();
        expect(openExternal).toHaveBeenCalledOnce();
        expect(decodeState(new URL(openExternal.mock.calls[0][0])).flowVariant).toBe('NATIVE_LINK_FLOW');
        expect(stages).toContain('OAUTH_NATIVE_LINK_OPENED');
    });

    it('propagates OAuth error descriptions and closes the popup', async () => {
        const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockReturnValue(popup);
        const appEvents = redirectWith(open, state => ({ state, error: 'access_denied', errorDescription: 'The user denied access' }));

        await expect(authenticateSalesforce({
            logger: new TestLogger(),
            params,
            authConfig,
            oauthFlow: new AppOAuthFlow(appEvents, PlatformType.WEB),
            http: null,
            forceReLogin: false,
            abortSignal: new AbortController().signal,
        })).rejects.toThrow('The user denied access');
        expect(popup.close).toHaveBeenCalledOnce();
    });

    it('rejects the callback of another flow variant', async () => {
        const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockReturnValue(popup);
        const appEvents = redirectWith(open, state => ({ state: { ...state, flowVariant: 'NATIVE_LINK_FLOW' }, code: 'authorization-code' }));
        await expect(authenticateSalesforce({
            logger: new TestLogger(), params, authConfig, oauthFlow: new AppOAuthFlow(appEvents, PlatformType.WEB),
            http: null, forceReLogin: false, abortSignal: new AbortController().signal,
        })).rejects.toThrow('flow variant');
    });

    it.each(['failed', 'aborted'])('does not report a received Data Cloud token when the exchange is %s', async outcome => {
        const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockReturnValue(popup);
        const abort = new AbortController();
        const stages: string[] = [];
        const http = fakeSalesforceHttp({
            exchangeError: outcome === 'failed' ? 'exchange failed' : null,
            onExchange: () => {
                if (outcome === 'aborted') abort.abort();
            },
        });
        await expect(authenticateSalesforce({
            logger: new TestLogger(), params, authConfig, oauthFlow: new AppOAuthFlow(redirectWith(open), PlatformType.WEB),
            http, forceReLogin: false,
            abortSignal: abort.signal, onProgress: progress => stages.push(progress.stage),
        })).rejects.toThrow();
        expect(stages).toContain('REQUESTING_DATA_CLOUD_ACCESS_TOKEN');
        expect(stages).not.toContain('RECEIVED_DATA_CLOUD_ACCESS_TOKEN');
        expect(popup.close).toHaveBeenCalledOnce();
    });

    it('closes the popup when waiting for the callback is aborted', async () => {
        const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
        vi.spyOn(window, 'open').mockReturnValue(popup);
        const abort = new AbortController();
        const appEvents = {
            waitForOAuthRedirect: vi.fn().mockImplementation(async () => {
                abort.abort();
                abort.signal.throwIfAborted();
            }),
        } as unknown as PlatformEventListener;

        await expect(authenticateSalesforce({
            logger: new TestLogger(),
            params,
            authConfig,
            oauthFlow: new AppOAuthFlow(appEvents, PlatformType.WEB),
            http: null,
            forceReLogin: false,
            abortSignal: abort.signal,
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(popup.close).toHaveBeenCalledOnce();
    });
});
