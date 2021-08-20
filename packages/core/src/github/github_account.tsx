// Copyright (c) 2020 The DashQL Authors

import React from 'react';
import github_oauth_script from './github_oauth.html';
import { graphql } from '@octokit/graphql';

/// Refs:
/// https://docs.github.com/en/free-pro-team@latest/developers/apps/authorizing-oauth-apps
/// https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/#available-scopes

const OAUTH_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID;
const OAUTH_REDIRECT_BASE_URI = process.env.PUBLIC_URL || window.location.origin;
const OAUTH_REDIRECT_URI = `${OAUTH_REDIRECT_BASE_URI}${github_oauth_script}`;
const OAUTH_SCOPES = 'gist read:user read:email';
const OAUTH_POPUP_NAME = 'DashQL GitHub OAuth';
const OAUTH_POPUP_SETTINGS = 'toolbar=no, menubar=no, width=600, height=700, top=100, left=100';

function generateOAuthSig() {
    let tag = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < 20; i++) {
        tag += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return tag;
}

type Props = {
    children: React.ReactElement;
};

type AccessToken = {
    /// The token
    token: string;
    /// The token type
    tokenType: string;
    /// The scope
    scope: string;
};

type State = {
    /// The popup window URL
    pendingAuth: string | null;
    /// The expected oauth state
    expectedAuthSig: string | null;
    /// The popup window
    openAuthWindow: Window | null;
    /// The authentication error
    authError: string | null;
    /// The code
    authCode: string | null;
    /// The github access token
    accessToken: AccessToken | null;
};

export interface GitHubAccountAuth {
    /// Login into an account
    login: () => void;
    /// Logout of an account
    logout: () => void;
}

const accountAuthCtx = React.createContext<GitHubAccountAuth>(null);
const githubAPICtx = React.createContext<typeof graphql>(null);

export const GitHubAccountProvider: React.FC<Props> = (props: Props) => {
    const [state, setState] = React.useState<State>({
        pendingAuth: null,
        expectedAuthSig: null,
        openAuthWindow: null,
        authCode: null,
        authError: null,
        accessToken: null,
    });

    // Maintain mount flag
    const isMountedRef = React.useRef<boolean>(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    // Register a receive for the oauth code from the window
    React.useEffect(() => {
        const handler = (event: any) => {
            const params = new URLSearchParams(event?.data);
            const code = params.get('code');
            const authSig = params.get('state');
            if (!code || !authSig) return;
            if (!isMountedRef.current) return;
            setState(s => {
                if (s.expectedAuthSig != authSig) {
                    console.warn('oauth state mismatch!');
                    return s;
                }
                console.log(`github code=${code} state=${authSig}`);
                return {
                    ...s,
                    authCode: code,
                };
            });
        };
        window.addEventListener('message', handler);
        return () => {
            window.removeEventListener('message', handler);
        };
    }, [setState]);

    // Effect to forget about the auth window when it closes
    React.useEffect(() => {
        if (!state.openAuthWindow) return () => {};
        const loop = setInterval(function () {
            if (state.openAuthWindow.closed) {
                clearInterval(loop);
                setState(s => {
                    if (!s.openAuthWindow) return s;
                    return {
                        ...s,
                        pendingAuth: null,
                        expectedAuthSig: null,
                        openAuthWindow: null,
                    };
                });
            }
        }, 1000);
        return () => {
            clearInterval(loop);
        };
    }, [state.openAuthWindow]);

    // Effect to open the auth window when there is a pending auth
    React.useEffect(() => {
        // Already done?
        if (!state.pendingAuth || state.openAuthWindow) return;
        // Open popup window
        const popup = window.open(state.pendingAuth, OAUTH_POPUP_NAME, OAUTH_POPUP_SETTINGS);
        if (!popup) {
            // Something went wrong, Browser might prevent the popup.
            // (E.g. FF blocks by default)
            setState(s => ({
                ...s,
                pendingAuth: null,
                expectedAuthSig: null,
                openAuthWindow: null,
                error: 'could not open OAuth window',
            }));
            return;
        }
        popup.focus();
        setState(s => ({
            ...s,
            openAuthWindow: popup,
        }));
    }, [state.pendingAuth, state.openAuthWindow]);

    // Login function initiated the OAuth login
    const login = React.useCallback(() => {
        if (!isMountedRef.current) return;

        // Construct the URI
        const redirectURI = encodeURIComponent(OAUTH_REDIRECT_URI);
        const authSig = generateOAuthSig();
        const scopes = encodeURIComponent(OAUTH_SCOPES);
        const params = [
            `client_id=${OAUTH_CLIENT_ID}`,
            `redirect_uri=${redirectURI}`,
            `scope=${scopes}`,
            `state=${authSig}`,
        ].join('&');
        const url = `https://github.com/login/oauth/authorize?${params}`;

        // Set the pending popup URL
        setState(s => {
            if (s.pendingAuth || s.openAuthWindow) return s;
            return {
                pendingAuth: url,
                expectedAuthSig: authSig,
                openAuthWindow: null,
                authError: null,
                authCode: null,
                accessToken: null,
            };
        });
    }, [setState]);

    // Logout function that clears any pending login
    const logout = React.useCallback(() => {
        if (!isMountedRef.current) return;
        setState(s => {
            if (s.openAuthWindow) s.openAuthWindow.close();
            return {
                pendingAuth: null,
                expectedAuthSig: null,
                openAuthWindow: null,
                authError: null,
                authCode: null,
                accessToken: null,
            };
        });
    }, [setState]);

    // Get the access token
    React.useEffect(() => {
        if (!state.authCode) return;
        (async () => {
            // Get the access token
            const data = new FormData();
            data.append('code', state.authCode);
            const response = await fetch('https://api.dashql.com/github/login/oauth/access_token', {
                method: 'POST',
                body: data,
            });
            const responseBody = await response.text();
            const responseData = new URLSearchParams(responseBody);
            const token = responseData.get('access_token');
            const tokenType = responseData.get('token_type');
            const scope = responseData.get('scope');

            console.log(`${token} ${tokenType} ${scope}`);

            // No longer mounted?
            if (!isMountedRef.current) return;
            setState(s => ({
                ...s,
                accessToken: {
                    token,
                    tokenType,
                    scope,
                },
            }));
        })();
    }, [state.authCode]);

    // Build the account login methods
    const auth = React.useMemo(
        (): GitHubAccountAuth => ({
            login,
            logout,
        }),
        [login, logout],
    );

    // Build the graphql client
    const apiClient = React.useMemo(() => {
        if (state.accessToken) {
            return graphql.defaults({
                headers: {
                    authorization: `${state.accessToken.tokenType} ${state.accessToken.token}`,
                },
            });
        } else {
            return graphql.defaults({});
        }
    }, [state.accessToken]);

    return (
        <accountAuthCtx.Provider value={auth}>
            <githubAPICtx.Provider value={apiClient}>{props.children}</githubAPICtx.Provider>
        </accountAuthCtx.Provider>
    );
};

export const useGitHubAuth = (): GitHubAccountAuth | null => React.useContext(accountAuthCtx);
export const useGitHubAPI = (): typeof graphql | null => React.useContext(githubAPICtx);
