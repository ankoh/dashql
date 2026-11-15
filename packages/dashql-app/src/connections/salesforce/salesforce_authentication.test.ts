import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OAuthState } from '@ankoh/dashql-runtime/oauth/oauth_types';
import { TestLogger } from '@ankoh/dashql-runtime/testing/test_logger';
import { PlatformType } from '../../platform/platform_type.js';
import { AppOAuthFlow } from '../../oauth/app_oauth_flow.js';
import { BASE64URL_CODEC } from '@ankoh/dashql-runtime/utils/base64';
import { SalesforceApiClient, type SalesforceApiClientInterface } from '@ankoh/dashql-runtime/connections/salesforce/salesforce_api_client';
import { authenticateSalesforce } from '@ankoh/dashql-runtime/connections/salesforce/salesforce_authentication';
import { DATA_CLOUD_JWT, fakeSalesforceHttp, type FakeSalesforceOptions } from './salesforce_test_http.js';

const params: connection.SalesforceConnectionParams = {
    instanceUrl: 'https://example.my.salesforce.com',
    appConsumerKey: 'consumer+key',
    appConsumerSecret: '',
    login: 'test+oauth@example.com',
};
const authConfig: connection.SalesforceOAuthConfig = {
    oauthRedirect: 'https://dashql.app/oauth.html',
};

/// An API client whose HTTP client answers like Salesforce
function apiClientOf(options: FakeSalesforceOptions = {}) {
    const http = fakeSalesforceHttp(options);
    return { http, apiClient: new SalesforceApiClient(new TestLogger(), http) };
}

function decodeState(url: URL): OAuthState {
    const encoded = url.searchParams.get('state')!;
    return JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(encoded)));
}

/// The redirect of the app hands back the callback with the state of the authorization URL
function redirectWith(open: { mock: { calls: unknown[][] } }, callback: (state: OAuthState) => object = state => ({ state, code: 'authorization-code' })) {
    return {
        waitForOAuthRedirect: vi.fn().mockImplementation(async () => callback(decodeState(new URL(String(open.mock.calls[0][0]))))),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// The login runs in the Rust runtime and sends its requests with the HTTP client of the API client. The URL and the
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
                oauthFlow: new AppOAuthFlow(redirectWith(open) as any, PlatformType.WEB),
                apiClient: apiClientOf().apiClient,
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
            logger: new TestLogger(), params, authConfig, oauthFlow: new AppOAuthFlow(redirectWith(open) as any, PlatformType.WEB),
            apiClient: apiClientOf().apiClient, forceReLogin: true, abortSignal: new AbortController().signal,
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
        const { http, apiClient } = apiClientOf({ userInfo: { preferred_username: 'user@example.com', organization_id: 'org-1' } });
        const stages: string[] = [];

        const result = await authenticateSalesforce({
            logger,
            params,
            authConfig,
            oauthFlow: new AppOAuthFlow(redirectWith(open) as any, PlatformType.WEB),
            apiClient,
            forceReLogin: false,
            abortSignal: new AbortController().signal,
            onProgress: progress => stages.push(progress.stage),
        });

        expect(result.coreAccessToken.accessToken).toBe('core-token');
        expect(result.dataCloudAccessToken.jwt.raw).toBe(DATA_CLOUD_JWT);
        expect(result.coreUserInfo?.preferredUsername).toBe('user@example.com');
        expect(result.coreUserInfo?.organizationId).toBe('org-1');
        expect(http.paths).toEqual(['/services/oauth2/token', '/services/oauth2/userinfo', '/services/a360/token']);
        // The setup logs on the target of the Salesforce setup
        expect(info).toHaveBeenCalledWith('Opening Salesforce OAuth authorization URL', expect.objectContaining({
            endpoint: 'https://example.my.salesforce.com/services/oauth2/authorize',
            flowVariant: 'WEB_OPENER_FLOW',
            authorizationParameters: expect.stringContaining('"client_id":"consumer+key"'),
            oauthState: expect.stringContaining('"flowId":"<redacted>"'),
        }), 'salesforce_setup');
        const opening = info.mock.calls.find(call => call[0] === 'Opening Salesforce OAuth authorization URL')!;
        const authorizationParameters = JSON.parse(opening[1].authorizationParameters as string);
        expect(authorizationParameters.redirect_uri).toBe('https://dashql.app/oauth.html');
        expect(authorizationParameters.code_challenge_method).toBe('S256');
        expect(authorizationParameters.response_type).toBe('code');
        expect(authorizationParameters.state).toBe('<redacted>');
        expect(authorizationParameters.code_challenge).toBe('<redacted>');
        expect(JSON.stringify(info.mock.calls)).not.toContain('test+oauth@example.com');
        expect(popup.close).toHaveBeenCalledOnce();
        expect(stages).toEqual([
            'GENERATING_PKCE_CHALLENGE',
            'GENERATED_PKCE_CHALLENGE',
            'OAUTH_WEB_WINDOW_OPENED',
            'OAUTH_WEB_WINDOW_CLOSED',
            'RECEIVED_CORE_AUTH_CODE',
            'REQUESTING_CORE_AUTH_TOKEN',
            'RECEIVED_CORE_AUTH_TOKEN',
            'RECEIVED_CORE_USER_INFO',
            'REQUESTING_DATA_CLOUD_ACCESS_TOKEN',
            'RECEIVED_DATA_CLOUD_ACCESS_TOKEN',
        ]);
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
            oauthFlow: new AppOAuthFlow(redirectWith(openExternal) as any, PlatformType.DESKTOP),
            apiClient: apiClientOf({ userInfo: null }).apiClient,
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
            oauthFlow: new AppOAuthFlow(appEvents as any, PlatformType.WEB),
            apiClient: {} as SalesforceApiClientInterface,
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
            logger: new TestLogger(), params, authConfig, oauthFlow: new AppOAuthFlow(appEvents as any, PlatformType.WEB),
            apiClient: {} as SalesforceApiClientInterface, forceReLogin: false, abortSignal: new AbortController().signal,
        })).rejects.toThrow('flow variant');
    });

    it.each(['failed', 'aborted'])('does not report a received Data Cloud token when the exchange is %s', async outcome => {
        const popup = { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockReturnValue(popup);
        const abort = new AbortController();
        const stages: string[] = [];
        const { apiClient } = apiClientOf({
            exchangeError: outcome === 'failed' ? 'exchange failed' : null,
            onExchange: () => {
                if (outcome === 'aborted') abort.abort();
            },
        });
        await expect(authenticateSalesforce({
            logger: new TestLogger(), params, authConfig, oauthFlow: new AppOAuthFlow(redirectWith(open) as any, PlatformType.WEB),
            apiClient, forceReLogin: false,
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
        };

        await expect(authenticateSalesforce({
            logger: new TestLogger(),
            params,
            authConfig,
            oauthFlow: new AppOAuthFlow(appEvents as any, PlatformType.WEB),
            apiClient: {} as SalesforceApiClientInterface,
            forceReLogin: false,
            abortSignal: abort.signal,
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(popup.close).toHaveBeenCalledOnce();
    });
});
