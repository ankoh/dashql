
import * as auth from '@ankoh/dashql-jsonschema/auth.js';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import getPkceImport from 'oauth-pkce';
export const getPkce = getPkceImport as unknown as (length: number | undefined, callback: (error: any, result: any) => void) => void;

// Generate PKCE challenge
export function generatePKCEChallenge(): Promise<auth.OAuthPKCEChallenge> {
    return new Promise<auth.OAuthPKCEChallenge>((resolve, reject) => {
        getPkce(64, (error: any, { verifier, challenge }: any) => {
            if (error != null) {
                reject(error);
            } else {
                const proto = {
                    value: challenge,
                    verifier
                };
                resolve(proto);
            }
        });
    });
}
