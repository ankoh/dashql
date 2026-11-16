export interface OAuthState {
    flowId: string;
    flowVariant: 'UNSPECIFIED_FLOW' | 'WEB_OPENER_FLOW' | 'NATIVE_LINK_FLOW';
    debugMode: boolean;
    callbackUrl?: string;
    /// The flavor of the app that started the flow, the redirect page is branded with it
    flavor?: string;
    salesforceProvider?: {
        instanceUrl: string;
        appConsumerKey: string;
        requestedAt: number;
        expiresAt: number;
    };
}

export interface OAuthRedirectData {
    state: OAuthState;
    code?: string;
    error?: string;
    errorDescription?: string;
}

export interface AppEventData {
    session?: string;
    oauthRedirect?: OAuthRedirectData;
}
