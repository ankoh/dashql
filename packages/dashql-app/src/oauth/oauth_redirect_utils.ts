import type { OAuthState } from './oauth_types.js';
import { AppFlavor, FLAVORS } from '../app/flavor/flavors.js';
import { BASE64URL_CODEC } from '../utils/base64.js';

const PUBLIC_OAUTH_ORIGINS = new Set(['https://dashql.app', 'https://hyperdb.sh']);
const DEVELOPMENT_OAUTH_HOSTS = new Set(['localhost', '127.0.0.1']);

export function isAllowedOAuthCallbackUrl(callbackUrl: string, currentUrl: URL): boolean {
    let target: URL;
    try {
        target = new URL(callbackUrl);
    } catch {
        return false;
    }
    if (target.pathname !== '/oauth.html' || target.search || target.username || target.password || target.hash) {
        return false;
    }
    if (target.origin === currentUrl.origin) {
        return true;
    }
    if (PUBLIC_OAUTH_ORIGINS.has(target.origin)) {
        return true;
    }
    return (target.protocol === 'http:' || target.protocol === 'https:')
        && DEVELOPMENT_OAUTH_HOSTS.has(target.hostname);
}

export function validateOAuthRedirectState(state: OAuthState, now = Date.now()): void {
    if (!state || typeof state !== 'object') {
        throw new Error('OAuth state is missing');
    }
    if (typeof state.flowId !== 'string' || state.flowId.length === 0) {
        throw new Error('OAuth state has no flow ID');
    }
    if (state.flowVariant !== 'WEB_OPENER_FLOW' && state.flowVariant !== 'NATIVE_LINK_FLOW') {
        throw new Error('OAuth state has an invalid flow variant');
    }
    const provider = state.salesforceProvider;
    if (!provider
        || typeof provider.instanceUrl !== 'string'
        || typeof provider.appConsumerKey !== 'string'
        || typeof provider.expiresAt !== 'number') {
        throw new Error('OAuth state has an invalid Salesforce provider');
    }
    if (provider.expiresAt <= now) {
        throw new Error('OAuth state has expired');
    }
}

/// Decode the base64url-encoded OAuth state of a redirect, it is validated separately
export function decodeOAuthState(encoded: string): OAuthState {
    const buffer = BASE64URL_CODEC.decode(encoded);
    return JSON.parse(new TextDecoder().decode(buffer)) as OAuthState;
}

/// Get the flavor carried in the encoded OAuth state, null if it carries none or an unknown one.
/// The state is not integrity-protected, the flavor only brands the redirect page.
export function getOAuthStateFlavor(encoded: string | null): AppFlavor | null {
    if (!encoded) {
        return null;
    }
    try {
        const flavor = decodeOAuthState(encoded)?.flavor;
        return typeof flavor === 'string' ? FLAVORS.get(flavor) ?? null : null;
    } catch {
        return null;
    }
}
