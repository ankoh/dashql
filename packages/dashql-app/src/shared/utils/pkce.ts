
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

function b64Uri(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Generate PKCE challenge
export async function generatePKCEChallenge(): Promise<auth.OAuthPKCEChallenge> {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    const verifier = b64Uri(bytes.buffer).substring(0, 64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { value: b64Uri(digest), verifier };
}
