import type { OAuthRedirectData } from './oauth_types.js';

/// What a flow shows the user while the user authorizes
export type OAuthFlowEvent =
    /// A window of the app shows the authorization page
    | 'WINDOW_OPENED'
    /// The window of the authorization page closed
    | 'WINDOW_CLOSED'
    /// The browser of the system shows the authorization page
    | 'EXTERNAL_BROWSER_OPENED';

/// What an authorization server sends to a loopback redirect URI
export interface OAuthLoopbackCallback {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
}

/// How a platform takes the user through the authorization of an OAuth provider. A connector builds the authorization
/// URL and exchanges the code for a token, the platform opens the URL and receives the redirect.
export interface OAuthFlow {
    /// How the redirect page (oauth.html) hands the callback back: to the window that opened it, or as a link of the
    /// desktop app
    readonly redirectVariant: 'WEB_OPENER_FLOW' | 'NATIVE_LINK_FLOW';
    /// The page of the app that the redirect page sends the callback to in a web opener flow
    readonly redirectCallbackUrl: string | null;
    /// Is the app a debug build? The redirect page shows the callback then.
    readonly debugMode: boolean;
    /// The flavor of the app, the redirect page is branded with it
    readonly flavor: string | null;

    /// Open the authorization URL and wait until the redirect page hands over a callback that `accepts` takes
    authorizeWithRedirectPage(
        authorizationUrl: URL,
        accepts: (callback: OAuthRedirectData) => boolean,
        signal: AbortSignal,
        onEvent: (event: OAuthFlowEvent) => void,
    ): Promise<OAuthRedirectData>;

    /// Receive the redirect on a loopback server at the callback URL, open the authorization URL and wait for the
    /// callback. Throws if the platform has no loopback server.
    authorizeWithLoopback(
        authorizationUrl: URL,
        callbackUrl: string,
        signal: AbortSignal,
        onEvent: (event: OAuthFlowEvent) => void,
    ): Promise<OAuthLoopbackCallback>;
}
