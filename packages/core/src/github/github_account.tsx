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
    /// The account
    account: GitHubAccount | null;
};

export interface GitHubAccount {
    /// The access token
    accessToken: string;
}

export interface GitHubAccountAPI {
    /// Login into an account
    login: () => void;
    /// Logout of an account
    logout: () => void;
}

const accountCtx = React.createContext<GitHubAccount | null>(null);
const accountAPICtx = React.createContext<GitHubAccountAPI>(null);

export const GitHubAccountProvider: React.FC<Props> = (props: Props) => {
    const [state, setState] = React.useState<State>({
        pendingAuth: null,
        expectedAuthSig: null,
        openAuthWindow: null,
        authCode: null,
        authError: null,
        account: null,
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

            const test = async () => {
                /// Get the access token
                const data = new FormData();
                data.append('code', code);
                const response = await fetch('https://api.dashql.com/github/login/oauth/access_token', {
                    method: 'POST',
                    body: data,
                });
                const responseBody = await response.text();
                const responseData = new URLSearchParams(responseBody);
                const token = responseData.get('access_token');
                // const token_type = responseData.get('token_type');
                // const scope = responseData.get('scope');

                // Query gists
                const graphqlWithAuth = graphql.defaults({
                    headers: {
                        authorization: `bearer ${token}`,
                    },
                });
                const result = await graphqlWithAuth(`
                query { 
                    viewer { 
                        gists (orderBy: {field: PUSHED_AT, direction: DESC}, first: 100) {
                            totalCount
                            edges {
                                node {
                                    resourcePath
                                    name
                                    description
                                    pushedAt
                                    stargazerCount
                                    isFork
                                    isPublic
                                    files {
                                        path: encodedName
                                        name
                                        size
                                    }
                                }
                            }
                            pageInfo {
                                endCursor
                                hasNextPage
                            }
                        }
                    }
                }
                `);
                console.log(result);
            };
            test().catch(e => console.error(e));
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
                account: null,
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
                account: null,
            };
        });
    }, [setState]);

    // Build the account API methods
    const api = React.useMemo(
        (): GitHubAccountAPI => ({
            login,
            logout,
        }),
        [login, logout],
    );
    return (
        <accountCtx.Provider value={state.account}>
            <accountAPICtx.Provider value={api}>{props.children}</accountAPICtx.Provider>
        </accountCtx.Provider>
    );
};

export const useGitHubAccount = (): GitHubAccount | null => React.useContext(accountCtx);
export const useGitHubAccountAPI = (): GitHubAccountAPI | null => React.useContext(accountAPICtx);
