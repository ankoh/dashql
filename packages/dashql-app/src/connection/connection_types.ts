/**
 * TypeScript-native connection types (replaces protobuf types)
 *
 * These types are used internally in connection state management.
 * For storage/serialization, use JSON schema types from @ankoh/dashql-jsonschema.
 */

/**
 * Detailed error information for connection failures
 */
export interface DetailedError {
    message: string;
    data?: Record<string, string>;
}

/**
 * OAuth state information
 */
export interface OAuthState {
    flowVariant: 'UNSPECIFIED_FLOW' | 'WEB_OPENER_FLOW' | 'NATIVE_LINK_FLOW';
    debugMode?: boolean;
    callbackUrl?: string;
    state?: string;
    codeVerifier?: string;
    authorizationUrl?: string;
    salesforceProvider?: {
        instanceUrl: string;
        appConsumerKey: string;
        requestedAt: number;
        expiresAt: number;
    };
}

/**
 * OAuth redirect data
 */
export interface OAuthRedirectData {
    state: string;
    code?: string;
    error?: string;
    errorDescription?: string;
}

/**
 * App event data for events
 */
export interface AppEventData {
    session?: string;
    oauthRedirect?: OAuthRedirectData;
}
